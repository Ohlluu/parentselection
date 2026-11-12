const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-tallies-'));
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'admin-tally-integration-test-secret';
const db = require('../db');
const app = require('../server');
const route = app._router.stack.find((s) => s.route?.path === '/api/admin/overview').route;
async function overview(admin) {
  let body;
  const res = { status() { return this; }, json(value) { body = value; } };
  await route.stack.at(-1).handle({ admin }, res);
  return body;
}
(async () => {
  await db.migrate();
  for (const site of ['first', 'second']) {
    await db.run("INSERT INTO sites (id,name,status) VALUES (?,?,'open')", [site, site]);
    for (const position of ['Chairperson', 'Secretary']) {
      const candidate = randomUUID();
      await db.run('INSERT INTO candidates (id,site_id,position,name) VALUES (?,?,?,?)', [candidate, site, position, 'Candidate ' + position]);
      for (let i = 0; i < 2; i++) {
        await db.run('INSERT INTO ballots (id,site_id,position,filled,choice_id) VALUES (?,?,?,TRUE,?)', [randomUUID(), site, position, candidate]);
      }
      await db.run('INSERT INTO candidates (id,site_id,position,name) VALUES (?,?,?,?)', [randomUUID(), site, position, 'Zero votes']);
    }
  }
  const superData = await overview({ role: 'super' });
  assert.equal(superData.sites.length, 2);
  assert.ok(superData.sites.every((s) => s.candidateContests.length === 2));
  assert.deepEqual(superData.sites[0].candidateContests[0].candidates.map((c) => c.votes), [2, 0]);
  assert.equal(superData.sites[0].candidateContests[0].candidates[0].leading, true);
  assert.equal(superData.sites[0].candidateContests[0].candidates[1].leading, false);
  const siteData = await overview({ role: 'site', site: 'first' });
  assert.equal(siteData.sites.length, 1);
  assert.equal(siteData.sites[0].id, 'first');
  assert.ok(siteData.sites[0].candidateContests.every((c) => c.candidates.every((candidate) => candidate.votes === null)));
  assert.ok(siteData.sites[0].candidateContests.every(c => c.candidates.every(candidate => candidate.leading === undefined)));
  assert.equal(siteData.sites[0].multiplePositionLeaders.length, 0);
  await db.run("UPDATE sites SET status='closed' WHERE id='first'");
  assert.equal((await overview({ role: 'site', site: 'first' })).sites[0].talliesVisible, false);
  await db.run("UPDATE sites SET results_released=TRUE WHERE id='first'");
  assert.equal((await overview({ role: 'site', site: 'first' })).sites[0].candidateContests[0].candidates[0].votes, 2);
  let unauthorized;
  route.stack[0].handle({ headers: {} }, {status(n) { unauthorized=n; return this; }, json() {}}, () => assert.fail('Unauthenticated request allowed'));
  assert.equal(unauthorized, 401);
  await db.run("UPDATE candidates SET name='Shared Parent' WHERE site_id='first' AND name LIKE 'Candidate %'");
  const tiedCandidate = await db.get("SELECT id FROM candidates WHERE site_id='first' AND position='Chairperson' AND name='Zero votes'");
  for (let i=0;i<2;i++) await db.run('INSERT INTO ballots (id,site_id,position,filled,choice_id) VALUES (?,?,?,TRUE,?)', [randomUUID(),'first','Chairperson',tiedCandidate.id]);
  await db.run('INSERT INTO candidates (id,site_id,position,name) VALUES (?,?,?,?)', [randomUUID(),'first','Community Rep','No Votes Parent']);
  const ranked = (await overview({role:'super'})).sites.find(s=>s.id==='first');
  const chair = ranked.candidateContests.find(c=>c.position==='Chairperson');
  assert.ok(chair.candidates.every(c=>c.leading && c.tied));
  const empty = ranked.candidateContests.find(c=>c.position==='Community Rep');
  assert.equal(empty.hasVotes, false);
  assert.equal(empty.candidates[0].leading, false);
  assert.equal(ranked.multiplePositionLeaders.length, 1);
  assert.equal(ranked.multiplePositionLeaders[0].name, 'Shared Parent');
  assert.equal(ranked.multiplePositionLeaders[0].positions.length, 2);
  console.log('Passed: weighted totals by center/position, zero-vote candidates, super-admin live access, site isolation, sealed totals until released, and authentication.');
  await db.closeDb();
})().catch(async (error) => { console.error(error); await db.closeDb(); process.exitCode = 1; });
