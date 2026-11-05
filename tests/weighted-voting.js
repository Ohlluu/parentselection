const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
if (!process.argv.includes('--validate')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighted-election-'));
  const env = { ...process.env, DATABASE_URL: '', PGLITE_DIR: dir, NODE_ENV: 'test', SESSION_SECRET: 'weighted-vote-integration-test-secret' };
  const roster = path.join(dir, 'voters.csv');
  const candidates = path.join(dir, 'candidates.csv');
  fs.writeFileSync(roster, 'site_id,site_name,full_name,email,children_count\nweighted,Test Center,Two Children,two@example.org,2\nweighted,Test Center,One Child,one@example.org,1\n');
  fs.writeFileSync(candidates, 'site_id,position,name\nweighted,Chairperson,Candidate A\nweighted,Secretary,Candidate B\n');
  for (const args of [['scripts/import-roster.js', 'voters', roster], ['scripts/import-roster.js', 'candidates', candidates], ['scripts/election.js', 'open', 'weighted'], [__filename, '--validate']]) {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    if (args[0] === __filename) process.stdout.write(result.stdout);
  }
} else {
  const db = require('../db');
  const app = require('../server');
  const handler = app._router.stack.find((s) => s.route?.path === '/api/vote').route.stack.at(-1).handle;
  async function vote(voter, choices) {
    let result;
    const res = { status() { return this; }, json(body) { result = body; }, setHeader() {} };
    await handler({ voterId: voter.id, body: { choices } }, res);
    return result;
  }
  (async () => {
    const voters = await db.all('SELECT * FROM voters');
    const candidates = await db.all('SELECT * FROM candidates');
    const choices = Object.fromEntries(candidates.map((c) => [c.position, c.id]));
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM ballots')).n, 6);
    const two = voters.find((v) => v.vote_weight === 2);
    assert.equal((await vote(two, choices)).ok, true);
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM ballots WHERE filled')).n, 4);
    assert.equal((await vote(two, choices)).error, 'already_voted');
    const one = voters.find((v) => v.vote_weight === 1);
    assert.equal((await vote(one, choices)).ok, true);
    const tally = await db.all('SELECT choice_id, COUNT(*)::int AS n FROM ballots WHERE filled GROUP BY choice_id');
    assert.equal(tally.length, 2);
    assert.ok(tally.every((r) => r.n === 3));
    // No voter reference or special weight marker is added to anonymous ballots.
    const columns = await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'ballots'");
    assert.deepEqual(columns.map((c) => c.column_name).sort(), ['choice_id', 'filled', 'id', 'position', 'site_id']);
    console.log('Passed weighted voting: two-child ballot counts twice, one-child ballot counts once, repeat voting rejected, ballot rows remain anonymous.');
    await db.closeDb();
  })().catch(async (error) => { console.error(error); await db.closeDb(); process.exitCode = 1; });
}
