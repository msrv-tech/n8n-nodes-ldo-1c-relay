'use strict';
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const P = require('../dist/nodes/Ldo1cRelay/pairing');
const Q = require('../dist/nodes/Ldo1cRelay/queue');
const {Ldo1cApi} = require('../dist/credentials/Ldo1cApi.credentials');
const {Ldo1cQueueApi} = require('../dist/credentials/Ldo1cQueueApi.credentials');
const {Ldo1cQueueTrigger} = require('../dist/nodes/Ldo1cQueueTrigger/Ldo1cQueueTrigger.node');
function fixture() {
 const rows=[], calls=[]; let nextId=1;
 const matches=(row,filter)=>!filter||filter.filters.every(f=>f.condition==='lte'?row[f.columnName]<=f.value:row[f.columnName]===f.value);
 const clone=v=>JSON.parse(JSON.stringify(v));
 const api=async req=>{
  calls.push(clone(req));
  const path=new URL(req.url).pathname;
  if(path==='/api/v1/workflows') return {id:'workflow-new'};
  if(path.endsWith('/activate')||path.endsWith('/deactivate')) return {id:'workflow-new'};
  if(path==='/api/v1/data-tables') return req.method==='POST'?{id:'table-new'}:{data:[{id:'table-new',name:'LDO 1C / Demo'}]};
  if(path==='/api/v1/data-tables/table-new') return {columns:Q.queueColumns};
  if(!path.startsWith('/api/v1/data-tables/table-new/')) throw new Error('Unknown table');
  if(req.method==='GET') return {data:clone(rows.filter(r=>matches(r,req.qs?.filter?JSON.parse(req.qs.filter):null)).slice(0,req.qs?.limit||100))};
  if(req.method==='POST') {const added=req.body.data.map(r=>({...r,id:nextId++}));rows.push(...added);return clone(added);}
  if(req.method==='PATCH') {const selected=rows.filter(r=>matches(r,req.body.filter));selected.forEach(r=>Object.assign(r,req.body.data));return clone(selected);}
  throw new Error('Unexpected request '+req.method+' '+path);
 };
 const context=()=>({getNode:()=>({name:'1C',type:'n8n-nodes-ldo-1c-relay.ldo1cRelay',typeVersion:2,parameters:{connectionId:'table-new'},credentials:{ldo1cQueueApi:{id:'cred-existing',name:'Saved own n8n'}}}),getCredentials:async()=>({apiUrl:'https://n8n.customer.test',apiToken:'private-api-key-never-in-code',minimumWaitSeconds:0}),helpers:{httpRequestWithAuthentication:async(type,req)=>{assert.equal(type,'ldo1cQueueApi');assert.ok(!req.url.includes('msrv.tech'));assert.equal(req.disableFollowRedirect,true);return api(req);}}});
 return {rows,calls,context};
}
function policy(revision=randomUUID(),serial=1) {return {contract_version:'1.0',action:'pair',database_id:randomUUID(),profile_id:randomUUID(),policy_revision:revision,policy_serial:serial,capabilities:{contract_version:'1.0',policy_revision:revision,object_types:[]},queue_token:randomBytes(40).toString('hex')};}
async function create(f) {const result=await P.createQueueConnection(f.context(),'Demo');const code=JSON.parse(Buffer.from(result.pairing_code.split(':')[1],'base64').toString());return {result,code};}
async function request(f,body,token,header='x-ldo-queue-token') {
 let status,reply;
 const c=f.context();c.getBodyData=()=>body;c.getHeaderData=()=>({[header]:token});c.getResponseObject=()=>({status:n=>{status=n;return {json:v=>{reply=v;}};}});
 assert.deepEqual(await new Ldo1cQueueTrigger().webhook.call(c),{noWebhookResponse:true});return {status,reply};
}
(async()=>{
 assert.deepEqual(new Ldo1cApi().properties.map(p=>p.name),['apiUrl','username','password']);
 assert.deepEqual(new Ldo1cQueueApi().properties.map(p=>p.name),['apiUrl','apiToken','minimumWaitSeconds']);
 const f=fixture(),{result,code}=await create(f),body={...policy(),pairing_id:code.pairing_id};
 assert.ok(code.expires_at-Date.now()>14*60*1000);assert.ok(code.expires_at-Date.now()<=15*60*1000);
 assert.ok(!result.pairing_code.includes('private-api-key'));assert.deepEqual(Object.keys(code).sort(),['expires_at','gateway_url','pairing_id','pairing_secret']);
 const workflow=f.calls.find(c=>c.url.endsWith('/workflows')).body;
 assert.equal(workflow.nodes[0].credentials.ldo1cQueueApi.id,'cred-existing');assert.equal(workflow.nodes[0].parameters.connectionId,'table-new');assert.ok(f.calls.some(c=>c.url.endsWith('/activate')));
 assert.ok(!f.rows[0].payload.includes(code.pairing_secret));
 await assert.rejects(()=>P.pairQueue(f.context(),body,'wrong'));
 await assert.rejects(()=>P.queueConnectionStatus({...f.context(),getNode:()=>({parameters:{connectionId:'missing'}})}));
 // A competing database can never rebind a code, even when both requests read pending state.
 const race=await Promise.allSettled([P.pairQueue(f.context(),body,code.pairing_secret),P.pairQueue(f.context(),{...body,database_id:randomUUID()},code.pairing_secret)]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows[0].database_id,body.database_id);
 assert.ok(!JSON.stringify(f.rows).includes(body.queue_token));assert.ok(!JSON.stringify(f.rows).includes(code.pairing_secret));
 const ack=await P.pairQueue(f.context(),JSON.parse(JSON.stringify(body)),code.pairing_secret);assert.equal(ack.status,'paired');
 await assert.rejects(()=>P.pairQueue(f.context(),{...body,queue_token:randomBytes(40).toString('hex')},code.pairing_secret));
 await assert.rejects(()=>P.renewQueuePairing(f.context()));
 assert.equal((await request(f,{...body,action:'ping'},'wrong')).status,401);
 assert.equal((await request(f,{...body,action:'ping',database_id:randomUUID()},body.queue_token)).status,400);
 assert.equal((await request(f,{...body,action:'ping'},body.queue_token)).status,200);
 // Restart: a fresh context recovers the paired scope from durable rows, not local memory.
 assert.equal((await Q.queueConfiguration(f.context())).databaseId,body.database_id);
 const finishedId=randomUUID(),pendingId=randomUUID(),flightId=randomUUID();
 const finished=await Q.enqueueCommand(f.context(),'document.get',finishedId,{});
 const flight=await Q.enqueueCommand(f.context(),'document.get',flightId,{});
 const leases=await Q.leaseRows(f.context(),'command',10);assert.equal(leases.length,2);
 const finishedLease=leases.find(r=>r.id===finished.id),flightLease=leases.find(r=>r.id===flight.id);
 const response=id=>({contract_version:'1.0',command_id:id,command_type:'document.get',status:'succeeded',data:{number:'INV-1'}});
 assert.equal((await request(f,{...body,action:'result',id:finished.id,lease_token:finishedLease.lease_token,result:response(finishedId)},body.queue_token)).status,200);
 await Q.enqueueCommand(f.context(),'document.get',pendingId,{});
 const rev2=randomUUID(),sync={...body,action:'sync',policy_serial:2,policy_revision:rev2,capabilities:{...body.capabilities,policy_revision:rev2}};
 assert.equal((await request(f,sync,body.queue_token)).status,200);
 assert.equal((await Q.commandResult(f.context(),pendingId)).error.code,'policy_revision_changed');
 assert.equal((await Q.commandResult(f.context(),finishedId)).data.number,'INV-1');
 // A leased result with the original revision survives an administrative policy change.
 assert.equal((await request(f,{...body,action:'result',id:flight.id,lease_token:flightLease.lease_token,result:response(flightId)},body.queue_token)).status,200);
 assert.equal((await Q.commandResult(f.context(),flightId)).status,'succeeded');
 assert.equal((await request(f,{...body,action:'sync'},body.queue_token)).status,400);
 assert.equal((await request(f,{...sync,policy_revision:randomUUID()},body.queue_token)).status,400);
 // Lost original acknowledgement remains recoverable after policy sync.
 assert.equal((await P.pairQueue(f.context(),body,code.pairing_secret)).policy_revision,body.policy_revision);
 await P.disconnectQueue(f.context());assert.equal((await request(f,{...sync,action:'ping'},body.queue_token)).status,401);
 const renewed=await P.renewQueuePairing(f.context());const nextCode=JSON.parse(Buffer.from(renewed.pairing_code.split(':')[1],'base64'));
 await assert.rejects(()=>P.pairQueue(f.context(),body,code.pairing_secret));
 const fresh={...policy(),pairing_id:nextCode.pairing_id};assert.equal((await P.pairQueue(f.context(),fresh,nextCode.pairing_secret)).status,'paired');
 const expired=fixture(),expiredCreation=await create(expired);const metadata=JSON.parse(expired.rows[0].payload);metadata.expires_at=0;expired.rows[0].payload=JSON.stringify(metadata);
 await assert.rejects(()=>P.pairQueue(expired.context(),{...policy(),pairing_id:expiredCreation.code.pairing_id},expiredCreation.code.pairing_secret),/expired/);
 console.log('Connection tests passed: simple credentials, public API setup, one-time pairing, CAS race, exact retry, expiry, durable restart, scope, policy sync, in-flight results, disconnect and re-pairing.');
})().catch(e=>{console.error(e);process.exit(1);});
