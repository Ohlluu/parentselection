const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {randomUUID}=require('crypto');
process.env.DATABASE_URL='';
process.env.PGLITE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'shared-results-'));
process.env.NODE_ENV='test';process.env.SESSION_SECRET='shared-results-integration-test-secret';
const db=require('../db'),auth=require('../auth'),app=require('../server');
function route(url){return app._router.stack.find(s=>s.route?.path===url).route;}
async function request(url,req){let body,code=200,headers={};const res={status(n){code=n;return this;},json(v){body=v;},setHeader(k,v){headers[k]=v;}};await route(url).stack.at(-1).handle(req,res);return {body,code,headers};}
(async()=>{
 await db.migrate();
 for(const id of ['one','two']){
  await db.run("INSERT INTO sites (id,name,status) VALUES (?,?,'open')",[id,id]);
  const candidate=randomUUID();
  await db.run('INSERT INTO candidates (id,site_id,name,position) VALUES (?,?,?,?)',[candidate,id,'Candidate Name','Chairperson']);
  await db.run('INSERT INTO voters (id,site_id,full_name,email,code) VALUES (?,?,?,?,?)',[randomUUID(),id,'Private Voter','private-'+id+'@example.org','PRIVATE-CODE']);
  for(let i=0;i<2;i++)await db.run('INSERT INTO ballots (id,site_id,position,filled,choice_id) VALUES (?,?,?,TRUE,?)',[randomUUID(),id,'Chairperson',candidate]);
 }
 const issued=await request('/api/admin/share-results',{});
 const token=new URLSearchParams(issued.body.path.split('#')[1]).get('token');
 assert.equal(auth.readSession(token).kind,'shared_results');
 assert.ok(auth.readSession(token).exp > Date.now()+29*86400000);
 const shared=await request('/api/shared-results',{headers:{authorization:'Bearer '+token}});
 assert.equal(shared.code,200);assert.equal(shared.headers['Cache-Control'],'no-store');
 assert.equal(shared.body.sites.length,2);
 assert.equal(shared.body.sites[0].candidateContests[0].candidates[0].votes,2);
 assert.deepEqual(Object.keys(shared.body.sites[0]).sort(),['candidateContests','id','name','status']);
 assert.ok(!JSON.stringify(shared.body).includes('PRIVATE-CODE'));assert.ok(!JSON.stringify(shared.body).includes('Private Voter'));
 for(const bad of ['',token+'tampered',auth.issueSession({kind:'admin',role:'super'})]){
  assert.equal((await request('/api/shared-results',{headers:{authorization:'Bearer '+bad}})).code,401);
 }
 let status;const res={status(n){status=n;return this;},json(){}};
 route('/api/admin/overview').stack[0].handle({headers:{cookie:'pe_session='+encodeURIComponent(token)}},res,()=>assert.fail('Shared token gained admin access'));
 assert.equal(status,401);
 status=undefined;route('/api/admin/share-results').stack[1].handle({admin:{role:'site'}},res,()=>assert.fail('Site admin created all-centers link'));assert.equal(status,403);
 const originalNow=Date.now;Date.now=()=>originalNow()+31*86400000;
 try{assert.equal((await request('/api/shared-results',{headers:{authorization:'Bearer '+token}})).code,401);}finally{Date.now=originalNow;}
 console.log('Passed: all-center weighted results, names/codes excluded, invalid/expired links rejected, shared links cannot act as admins, link creation restricted to super admins.');
 await db.closeDb();
})().catch(async e=>{console.error(e);await db.closeDb();process.exitCode=1;});
