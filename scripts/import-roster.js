#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const { run, get, all, migrate, closeDb } = require('../db');
const { generateCode, normalizeCode } = require('../auth');
const { readCsvObjects } = require('./csv');

const USAGE = `
Usage:
  node scripts/import-roster.js voters     <file.csv>
  node scripts/import-roster.js candidates <file.csv>
  node scripts/import-roster.js admins     <file.csv>

Expected columns (header row required, order does not matter):
  voters      site_id, site_name, full_name, email, code (optional)
  candidates  site_id, name, blurb (optional), sort_order (optional)
  admins      email, full_name, role (super|site), site_id, code (optional)

Leave the code column out and one is generated. Supply it to set a specific
code - useful for testing, or for carrying codes over from a previous run.

Re-running is safe: existing rows are updated in place, not duplicated, and
anyone who has already voted is left untouched.
`;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

async function ensureSite(siteId, siteName) {
  const existing = await get('SELECT id FROM sites WHERE id = ?', [siteId]);
  if (existing) {
    if (siteName) await run('UPDATE sites SET name = ? WHERE id = ?', [siteName, siteId]);
    return;
  }
  await run(`INSERT INTO sites (id, name, seats, status) VALUES (?, ?, 1, 'draft')`, [
    siteId,
    siteName || siteId,
  ]);
  console.log(`  + created site "${siteName || siteId}" (${siteId})`);
}

async function importVoters(rows) {
  let added = 0;
  let updated = 0;
  const seen = new Map();

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const email = normalizeEmail(row.email);
    const siteId = (row.site_id || '').trim();
    const fullName = (row.full_name || row.name || '').trim();
    const supplied = normalizeCode(row.code);

    if (!email || !email.includes('@')) {
      console.warn(`  ! line ${line}: missing or invalid email, skipped`);
      continue;
    }
    if (!siteId) {
      console.warn(`  ! line ${line}: missing site_id for ${email}, skipped`);
      continue;
    }
    if (!fullName) {
      console.warn(`  ! line ${line}: missing full_name for ${email}, skipped`);
      continue;
    }
    // A shared household address would silently cost one parent their vote,
    // so surface it here rather than letting it disappear into the roster.
    if (seen.has(email)) {
      console.warn(`  ! line ${line}: duplicate email ${email} (also line ${seen.get(email)}), skipped`);
      continue;
    }
    seen.set(email, line);

    await ensureSite(siteId, (row.site_name || '').trim());

    const existing = await get('SELECT id, has_voted FROM voters WHERE email = ?', [email]);
    if (existing) {
      if (existing.has_voted) {
        console.warn(`  ! ${email} has already voted - left unchanged`);
        continue;
      }
      // Keep the existing code unless the CSV supplies a new one, so
      // re-importing a roster does not invalidate codes already sent out.
      if (supplied) {
        await run('UPDATE voters SET site_id = ?, full_name = ?, code = ? WHERE id = ?', [
          siteId, fullName, supplied, existing.id,
        ]);
      } else {
        await run('UPDATE voters SET site_id = ?, full_name = ? WHERE id = ?', [
          siteId, fullName, existing.id,
        ]);
      }
      updated++;
    } else {
      await run(
        'INSERT INTO voters (id, site_id, email, full_name, code, has_voted) VALUES (?, ?, ?, ?, ?, FALSE)',
        [randomUUID(), siteId, email, fullName, supplied || generateCode()]
      );
      added++;
    }
  }

  console.log(`\n  ${added} voters added, ${updated} updated.`);

  const bySite = await all(
    `SELECT s.name, s.id, COUNT(v.id)::int AS n
       FROM sites s LEFT JOIN voters v ON v.site_id = s.id
      GROUP BY s.id, s.name ORDER BY s.name`
  );
  console.log('\n  Roster by site:');
  for (const site of bySite) console.log(`    ${site.name} (${site.id}): ${site.n}`);
  console.log(`    ---\n    total: ${bySite.reduce((sum, s) => sum + s.n, 0)}`);
  console.log('\n  Export the codes with:  node scripts/election.js codes');
}

async function importCandidates(rows) {
  let added = 0;
  // Contests appear on the ballot in this order unless position_order says
  // otherwise. Anything unrecognised sorts after the known offices.
  const DEFAULT_ORDER = ['chair', 'vice chair', 'secretary', 'community rep'];

  for (const [index, row] of rows.entries()) {
    const siteId = (row.site_id || '').trim();
    const name = (row.name || row.full_name || '').trim();
    const position = (row.position || '').trim();

    if (!siteId || !name || !position) {
      console.warn(`  ! line ${index + 2}: needs site_id, position and name, skipped`);
      continue;
    }
    await ensureSite(siteId, (row.site_name || '').trim());

    const known = DEFAULT_ORDER.indexOf(position.toLowerCase());
    const order = row.position_order !== undefined && row.position_order !== ''
      ? Number(row.position_order)
      : (known === -1 ? DEFAULT_ORDER.length : known);

    const existing = await get(
      'SELECT id FROM candidates WHERE site_id = ? AND position = ? AND name = ?',
      [siteId, position, name]
    );
    if (existing) {
      await run('UPDATE candidates SET blurb = ?, sort_order = ?, position_order = ? WHERE id = ?', [
        row.blurb || null,
        Number(row.sort_order || 0),
        order,
        existing.id,
      ]);
      continue;
    }
    await run(
      `INSERT INTO candidates (id, site_id, position, position_order, name, blurb, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), siteId, position, order, name, row.blurb || null, Number(row.sort_order || 0)]
    );
    added++;
  }
  console.log(`\n  ${added} candidates added.\n`);

  const bySite = await all(
    `SELECT s.name AS site, c.position, COUNT(c.id)::int AS n
       FROM sites s JOIN candidates c ON c.site_id = s.id
      GROUP BY s.name, c.position, c.position_order
      ORDER BY s.name, c.position_order, c.position`
  );
  let current = null;
  for (const row of bySite) {
    if (row.site !== current) {
      console.log(`    ${row.site}`);
      current = row.site;
    }
    console.log(`      ${row.position.padEnd(18)} ${row.n} candidate(s)`);
  }
}

async function importAdmins(rows) {
  let added = 0;
  const issued = [];

  for (const [index, row] of rows.entries()) {
    const email = normalizeEmail(row.email);
    const fullName = (row.full_name || row.name || '').trim();
    const role = (row.role || 'site').trim().toLowerCase();
    const supplied = normalizeCode(row.code);

    if (!email || !fullName) {
      console.warn(`  ! line ${index + 2}: needs email and full_name, skipped`);
      continue;
    }
    if (role !== 'super' && role !== 'site') {
      console.warn(`  ! line ${index + 2}: role must be "super" or "site", skipped`);
      continue;
    }
    const siteId = role === 'site' ? (row.site_id || '').trim() : null;
    if (role === 'site' && !siteId) {
      console.warn(`  ! line ${index + 2}: site admins need a site_id, skipped`);
      continue;
    }
    if (siteId) await ensureSite(siteId, '');

    const existing = await get('SELECT id, code FROM admins WHERE email = ?', [email]);
    if (existing) {
      const code = supplied || existing.code;
      await run('UPDATE admins SET full_name = ?, role = ?, site_id = ?, code = ? WHERE id = ?', [
        fullName, role, siteId, code, existing.id,
      ]);
      issued.push([email, code]);
      continue;
    }
    const code = supplied || generateCode();
    await run('INSERT INTO admins (id, email, full_name, code, role, site_id) VALUES (?, ?, ?, ?, ?, ?)', [
      randomUUID(), email, fullName, code, role, siteId,
    ]);
    issued.push([email, code]);
    added++;
  }

  console.log(`\n  ${added} admins added.\n`);
  console.log('  Admin sign-in codes:');
  for (const [email, code] of issued) console.log(`    ${email.padEnd(34)} ${code}`);
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!mode || !file) {
    console.log(USAGE);
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  await migrate();
  const rows = readCsvObjects(fs.readFileSync(fullPath, 'utf8'));
  console.log(`\nReading ${rows.length} rows from ${path.basename(fullPath)}...\n`);

  if (mode === 'voters') await importVoters(rows);
  else if (mode === 'candidates') await importCandidates(rows);
  else if (mode === 'admins') await importAdmins(rows);
  else {
    console.log(USAGE);
    process.exit(1);
  }

  console.log('');
  await closeDb();
}

main().catch(async (err) => {
  console.error('Import failed:', err.message);
  await closeDb().catch(() => {});
  process.exit(1);
});
