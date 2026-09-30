#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { run, get, all, migrate, closeDb, usingPostgres } = require('../db');
const { generateCode } = require('../auth');

const USAGE = `
Usage:
  node scripts/election.js migrate             create tables (safe to re-run)
  node scripts/election.js status              turnout + reconciliation
  node scripts/election.js codes [file.csv]    export every parent's code
  node scripts/election.js seats   <site_id> <n>
  node scripts/election.js open    <site_id|all>
  node scripts/election.js close   <site_id|all>
  node scripts/election.js finalize
  node scripts/election.js results <site_id>

Typical run:
  1. import voters, candidates and admins
  2. codes     - export the list, then mail-merge it out to parents
  3. seats     - only if a site elects more than one representative
  4. open      - seeds the ballot box and lets parents vote
  5. close     - stops voting
  6. finalize  - shuffles the ballot box, then results can be read
`;

async function status() {
  const sites = await all(
    `SELECT s.id, s.name, s.status, s.results_released,
            (SELECT COUNT(*)::int FROM voters v WHERE v.site_id = s.id) AS eligible,
            (SELECT COUNT(*)::int FROM voters v WHERE v.site_id = s.id AND v.has_voted) AS voted,
            (SELECT COUNT(DISTINCT c.position)::int FROM candidates c WHERE c.site_id = s.id) AS contests,
            (SELECT COUNT(*)::int FROM candidates c WHERE c.site_id = s.id) AS candidates,
            (SELECT COUNT(*)::int FROM ballots b WHERE b.site_id = s.id AND b.filled) AS cast
       FROM sites s ORDER BY s.name`
  );

  if (!sites.length) {
    console.log('\nNo sites yet. Import a voter roster first.\n');
    return;
  }

  console.log(`\nDatabase: ${usingPostgres ? 'Postgres (DATABASE_URL)' : 'local PGlite (.pgdata)'}\n`);
  console.log('  SITE                            STATUS   POS  CANDS  ELIGIBLE  VOTED  BALLOTS');
  console.log('  ' + '-'.repeat(80));

  let totalEligible = 0;
  let totalVoted = 0;
  for (const s of sites) {
    totalEligible += s.eligible;
    totalVoted += s.voted;
    console.log(
      '  ' +
        s.name.slice(0, 30).padEnd(32) +
        s.status.padEnd(9) +
        String(s.contests).padEnd(5) +
        String(s.candidates).padEnd(7) +
        String(s.eligible).padEnd(10) +
        String(s.voted).padEnd(7) +
        String(s.cast)
    );
  }
  console.log('  ' + '-'.repeat(80));
  console.log('  TOTAL'.padEnd(63) + String(totalEligible).padEnd(10) + String(totalVoted));

  // The reconciliation check. Each voter fills one ballot per contest, all in
  // the same transaction, so filled ballots must be exactly voted x contests.
  // If that ever fails to hold, something is wrong and the result should not
  // be certified.
  const mismatched = sites.filter((s) => s.cast !== s.voted * s.contests);
  if (mismatched.length) {
    console.log('\n  WARNING - registry and ballot box disagree at:');
    for (const s of mismatched) {
      console.log(
        `    ${s.name}: ${s.voted} voted x ${s.contests} positions = ${s.voted * s.contests} expected, ${s.cast} recorded`
      );
    }
  } else {
    console.log('\n  Reconciled: ballots recorded match voters marked at every site.');
  }

  const outstanding = totalEligible - totalVoted;
  console.log(
    outstanding === 0
      ? '\n  All eligible parents have voted.\n'
      : `\n  ${outstanding} parent(s) still to vote.\n`
  );
}

// The mail-merge source. Writes name, email and code per site so you can send
// each parent their own code from your own email account.
async function codes(target) {
  const voters = await all(
    `SELECT s.name AS site, v.full_name, v.email, v.code, v.has_voted
       FROM voters v JOIN sites s ON s.id = v.site_id
      ORDER BY s.name, v.full_name`
  );
  if (!voters.length) {
    console.log('\nNo voters on the roster yet.\n');
    return;
  }

  const escape = (value) => {
    const text = String(value ?? '');
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [
    'site,name,email,code,voted',
    ...voters.map((v) =>
      [v.site, v.full_name, v.email, v.code, v.has_voted ? 'yes' : 'no'].map(escape).join(',')
    ),
  ].join('\n');

  if (target) {
    const out = path.resolve(process.cwd(), target);
    fs.writeFileSync(out, csv);
    console.log(`\n  ${voters.length} codes written to ${out}`);
    console.log('  Treat this file like a stack of blank ballots - anyone holding it can vote.\n');
  } else {
    console.log('');
    for (const v of voters) {
      console.log(`  ${v.site.padEnd(16)} ${v.full_name.padEnd(24)} ${v.email.padEnd(32)} ${v.code}`);
    }
    console.log(`\n  ${voters.length} total. Pass a filename to write this as CSV.\n`);
  }
}

async function setSeats(siteId, n) {
  const seats = Number(n);
  if (!Number.isInteger(seats) || seats < 1) {
    console.error('Seats must be a whole number of 1 or more.');
    process.exit(1);
  }
  const site = await get('SELECT status FROM sites WHERE id = ?', [siteId]);
  if (!site) {
    console.error(`No such site: ${siteId}`);
    process.exit(1);
  }
  if (site.status !== 'draft') {
    console.error('Seats can only change while the site is in draft.');
    process.exit(1);
  }
  await run('UPDATE sites SET seats = ? WHERE id = ?', [seats, siteId]);
  console.log(`\n  ${siteId} now elects ${seats} representative(s).\n`);
}

async function openSite(site) {
  const eligible = await get('SELECT COUNT(*)::int AS n FROM voters WHERE site_id = ?', [site.id]);
  const positions = await all(
    `SELECT position, COUNT(*)::int AS candidates FROM candidates WHERE site_id = ?
      GROUP BY position, position_order ORDER BY position_order, position`,
    [site.id]
  );

  if (eligible.n === 0) {
    console.log(`  ! ${site.name}: no voters on the roster, skipped`);
    return;
  }
  if (positions.length === 0) {
    console.log(`  ! ${site.name}: no candidates, skipped`);
    return;
  }

  // Seed the ballot box: one blank ballot per eligible parent PER CONTEST,
  // created before anyone votes. Casting a vote fills a blank at random in
  // each contest rather than appending, so insertion order says nothing about
  // who voted when, and the four choices are not stored together.
  for (const { position } of positions) {
    const existing = await get(
      'SELECT COUNT(*)::int AS n FROM ballots WHERE site_id = ? AND position = ?',
      [site.id, position]
    );
    const filled = await get(
      'SELECT COUNT(*)::int AS n FROM ballots WHERE site_id = ? AND position = ? AND filled',
      [site.id, position]
    );

    const needed = eligible.n - existing.n;
    if (needed > 0) {
      if (filled.n > 0) {
        console.log(`  ! ${site.name} / ${position}: voting started, topping up ${needed} blank(s)`);
      }
      for (let i = 0; i < needed; i++) {
        await run(
          'INSERT INTO ballots (id, site_id, position, filled, choice_id) VALUES (?, ?, ?, FALSE, NULL)',
          [randomUUID(), site.id, position]
        );
      }
    } else if (needed < 0) {
      const removable = await all(
        'SELECT id FROM ballots WHERE site_id = ? AND position = ? AND filled = FALSE LIMIT ?',
        [site.id, position, -needed]
      );
      for (const ballot of removable) await run('DELETE FROM ballots WHERE id = ?', [ballot.id]);
    }
  }

  await run(`UPDATE sites SET status = 'open' WHERE id = ?`, [site.id]);
  const summary = positions.map((p) => `${p.position} (${p.candidates})`).join(', ');
  console.log(`  + ${site.name}: open, ${eligible.n} eligible - ${summary}`);
}

async function open(target) {
  const sites =
    target === 'all'
      ? await all(`SELECT id, name, seats FROM sites WHERE status != 'closed' ORDER BY name`)
      : await all('SELECT id, name, seats FROM sites WHERE id = ?', [target]);

  if (!sites.length) {
    console.error(target === 'all' ? 'No sites to open.' : `No such site: ${target}`);
    process.exit(1);
  }

  console.log('');
  for (const site of sites) await openSite(site);
  console.log('');
}

async function close(target) {
  const sites =
    target === 'all'
      ? await all(`SELECT id, name FROM sites WHERE status = 'open'`)
      : await all('SELECT id, name FROM sites WHERE id = ?', [target]);

  if (!sites.length) {
    console.error(target === 'all' ? 'No open sites.' : `No such site: ${target}`);
    process.exit(1);
  }

  console.log('');
  for (const site of sites) {
    await run(`UPDATE sites SET status = 'closed' WHERE id = ?`, [site.id]);
    console.log(`  + ${site.name}: closed`);
  }
  console.log('\n  Run "node scripts/election.js finalize" before reading results.\n');
}

// Rewrites the ballot box into a freshly shuffled table.
// Postgres stamps every row with the transaction that last wrote it (the
// hidden xmin column), so update order - which is vote order - is recoverable
// by anyone who can query the database directly. Rebuilding the table from a
// randomly ordered SELECT gives every row the same new stamp and destroys it.
async function finalize() {
  const stillOpen = await get(`SELECT COUNT(*)::int AS n FROM sites WHERE status = 'open'`);
  if (stillOpen.n > 0) {
    console.error(`\n  ${stillOpen.n} site(s) are still open. Close them all before finalizing.\n`);
    process.exit(1);
  }

  await run('BEGIN');
  try {
    await run(`CREATE TABLE ballots_shuffled (
      id UUID PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      position TEXT NOT NULL,
      filled BOOLEAN NOT NULL DEFAULT FALSE,
      choice_ids JSONB
    )`);
    await run(
      `INSERT INTO ballots_shuffled (id, site_id, position, filled, choice_id)
       SELECT id, site_id, position, filled, choice_id FROM ballots ORDER BY random()`
    );
    await run('DROP TABLE ballots');
    await run('ALTER TABLE ballots_shuffled RENAME TO ballots');
    await run('CREATE INDEX IF NOT EXISTS idx_ballots_open ON ballots(site_id, position, filled)');
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }

  console.log('\n  Ballot box shuffled. Results can now be read.');
  console.log('  Reminder: if your host keeps database history or point-in-time');
  console.log('  recovery, the pre-shuffle state may still exist there.\n');
}

async function results(siteId) {
  const site = await get('SELECT id, name, seats, status FROM sites WHERE id = ?', [siteId]);
  if (!site) {
    console.error(`No such site: ${siteId}`);
    process.exit(1);
  }
  if (site.status !== 'closed') {
    console.error('\n  This site is still open. Close it before reading results.\n');
    process.exit(1);
  }

  const candidates = await all(
    `SELECT id, name, position FROM candidates WHERE site_id = ?
      ORDER BY position_order, position, name`,
    [siteId]
  );
  const ballots = await all(
    'SELECT position, choice_id FROM ballots WHERE site_id = ? AND filled',
    [siteId]
  );

  const tally = Object.fromEntries(candidates.map((c) => [c.id, 0]));
  for (const ballot of ballots) {
    if (ballot.choice_id in tally) tally[ballot.choice_id] += 1;
  }

  console.log(`\n  ${site.name}\n`);

  const positions = [...new Set(candidates.map((c) => c.position))];
  let anyTie = false;

  for (const position of positions) {
    const ranked = candidates
      .filter((c) => c.position === position)
      .map((c) => ({ name: c.name, votes: tally[c.id] }))
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

    const cast = ballots.filter((b) => b.position === position).length;
    const tied = ranked.length > 1 && ranked[0].votes === ranked[1].votes;
    if (tied) anyTie = true;

    console.log(`  ${position}  (${cast} votes cast)`);
    ranked.forEach((c, i) => {
      console.log(`    ${i === 0 && !tied ? '*' : ' '} ${c.name.padEnd(28)} ${c.votes}`);
    });
    if (tied) console.log('      TIE - resolve under your bylaws, not by this ordering.');
    console.log('');
  }

  console.log(anyTie ? '  * = elected, where not tied\n' : '  * = elected\n');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  await migrate();

  switch (command) {
    case 'migrate':
      return console.log('\n  Tables are up to date.\n');
    case 'status':
      return status();
    case 'codes':
      return codes(args[0]);
    case 'seats':
      return setSeats(args[0], args[1]);
    case 'open':
      return open(args[0] || 'all');
    case 'close':
      return close(args[0] || 'all');
    case 'finalize':
      return finalize();
    case 'results':
      return results(args[0]);
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('Command failed:', err.message);
    await closeDb().catch(() => {});
    process.exit(1);
  });
