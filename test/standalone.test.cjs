'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Ldo1cRelay } = require('../dist/nodes/Ldo1cRelay/Ldo1cRelay.node');
const { Ldo1cQueueTrigger } = require('../dist/nodes/Ldo1cQueueTrigger/Ldo1cQueueTrigger.node');
const { Ldo1cApi } = require('../dist/credentials/Ldo1cApi.credentials');
const { Ldo1cQueueApi } = require('../dist/credentials/Ldo1cQueueApi.credentials');
const { connectionMode, connectionUrl, directCommand } = require('../dist/nodes/Ldo1cRelay/connection');
const Q = require('../dist/nodes/Ldo1cRelay/queue');
const P = require('../dist/nodes/Ldo1cRelay/pairing');
const descriptor = () => ({contract_version:'1.0',status:'connected',profile_id:direct.profileId,policy_revision:direct.policyRevision,capabilities:{contract_version:'1.0',policy_revision:direct.policyRevision,object_types:[]}});
const directHandler = handler => async(req) => req.method==='GET'?descriptor():handler(req);
const direct = { apiUrl:'https://1c.customer.test/base/hs/ldo_n8n',username:'test-user',password:'synthetic-password',profileId:randomUUID(),policyRevision:randomUUID() };
const queue = { apiUrl:'https://n8n.customer.test',apiToken:'synthetic-n8n-api-key',tableId:'queue-table',databaseId:randomUUID(),profileId:direct.profileId,policyRevision:direct.policyRevision,queueToken:'synthetic-queue-token-at-least-32-characters',minimumWaitSeconds:0 };
function ctx(mode, params={}, handler=async()=>({})) {
 const calls=[];
 return { calls,getNode:()=>({name:'1C',type:'n8n-nodes-ldo-1c-relay.ldo1cRelay',typeVersion:2,parameters:{connectionMode:mode,connectionId:'queue-table'}}),getCredentials:async(type)=>{ assert.equal(type,mode==='direct'?'ldo1cApi':'ldo1cQueueApi'); return mode==='direct'?direct:queue; },getNodeParameter:(key,index,fallback)=>params[key]??fallback,getInputData:()=>[{json:{}}],continueOnFail:()=>false,helpers:{httpRequestWithAuthentication:async(type,request)=>{ assert.ok(!new URL(request.url).hostname.endsWith('msrv.tech'));calls.push(request);return mode==='direct' && request.method==='GET'?descriptor():handler(request,type); },prepareBinaryData:async(content,filename,mimeType)=>({data:content.toString('base64'),fileName:filename,mimeType})} };
}
function memory() {
 const rows=[{id:1,database_id:queue.databaseId,profile_id:queue.profileId,policy_revision:queue.policyRevision,kind:'connection',status:'paired',payload:JSON.stringify({protocol:'ldo.queue.connection/1',name:'Demo',pairing_id:randomUUID(),token_hash:P.secretHash(queue.queueToken),capabilities:descriptor().capabilities,policy_serial:1})}];
 const matches=(row,filter)=>filter.filters.every(f=>f.condition==='lte'?row[f.columnName]<=f.value:row[f.columnName]===f.value);
 const handler=async(req)=> {
  if(req.method==='GET' && !req.qs) return {columns:Q.queueColumns};
  if(req.method==='GET') return {data:rows.filter(r=>matches(r,JSON.parse(req.qs.filter))).map(r=>({...r}))};
  if(req.method==='POST') { const result=req.body.data.map(r=>({...r,id:rows.length+1}));rows.push(...result);return result.map(r=>({...r})); }
  if(req.method==='DELETE') { const selected=rows.filter(r=>matches(r,JSON.parse(req.qs.filter)));for(const row of selected)rows.splice(rows.indexOf(row),1);return selected.map(r=>({...r})); }
  if(req.method==='PATCH') { const selected=rows.filter(r=>matches(r,req.body.filter));for(const row of selected)Object.assign(row,req.body.data);return selected.map(r=>({...r})); }
  throw new Error('Unexpected API operation');
 };
 return {rows,handler,context:ctx('queue',{},handler)};
}
(async()=>{
 assert.equal(connectionMode({getNode:()=>({typeVersion:2,parameters:{}})}),'queue');
 assert.equal(connectionMode({getNode:()=>({parameters:{}})}),'queue');
 assert.equal(connectionMode({getNode:()=>({typeVersion:1,parameters:{connectionMode:'direct'}})}),'msrv');
 for(const url of ['https://api.ldo.msrv.tech','https://MSRV.tech.','https://x.msrv.tech./','https://u:p@customer.test','file:///tmp/a']) assert.throws(()=>connectionUrl(url,true));
 assert.equal(connectionUrl('https://customer.test/',true),'https://customer.test');
 const c=ctx('direct',{},async(req)=>({contract_version:'1.0',command_id:req.body.command_id,command_type:req.body.command_type,status:'succeeded',data:{operations:['document.get']}}));
 assert.deepEqual((await directCommand(c,'n8n.document.get',{object:{type:'document.Invoice',id:randomUUID()}})).data,{operations:['document.get']});
 assert.equal(c.calls.length,2);assert.equal(c.calls[0].url,direct.apiUrl+'/connection');assert.equal(c.calls[1].url,direct.apiUrl+'/commands');assert.equal(c.calls[1].body.payload.profile_id,direct.profileId);
 await assert.rejects(()=>directCommand(ctx('direct',{},async()=>({contract_version:'1.0',command_id:randomUUID(),command_type:'document.get',status:'succeeded',data:{}})),'document.get',{}));
 await assert.rejects(()=>directCommand(ctx('direct',{},async(req)=>({contract_version:'1.0',command_id:req.body.command_id,command_type:req.body.command_type,status:'failed',error:{message:'revision_conflict'}})),'document.get',{}),/revision_conflict/);
 const pdf=ctx('direct',{resource:'operation',operation:'documentFilePrepare',timeoutSeconds:1,pollSeconds:1},async(req)=>({contract_version:'1.0',command_id:req.body.command_id,command_type:req.body.command_type,status:'succeeded',data:{}}));
 await assert.rejects(()=>Ldo1cRelay.prototype.execute.call(pdf),/standalone PDF/);assert.equal(pdf.calls.length,1);assert.equal(pdf.calls[0].method,'GET');
 for(const Credential of [Ldo1cApi,Ldo1cQueueApi]) { const credential=new Credential();const values=Credential===Ldo1cApi?direct:queue;await assert.rejects(()=>credential.authenticate({...values,apiUrl:'https://api.ldo.msrv.tech'},{}));assert.equal(credential.properties.find(p=>p.name==='apiUrl').default,''); }
 const m=memory(),id=randomUUID();const row=await Q.enqueueCommand(m.context,'document.get',id,{object:{type:'document.Invoice',id:randomUUID()}});
 const payload=JSON.parse(row.payload);delete payload.contract_version;delete payload.profile_id;delete payload.policy_revision;
 assert.equal((await Q.enqueueCommand(m.context,'document.get',id,payload)).id,row.id);
 await assert.rejects(()=>Q.enqueueCommand(m.context,'document.get',id,{object:{type:'document.Other',id:randomUUID()}}));
 const leased=(await Promise.all(Array.from({length:8},()=>Q.leaseRows(m.context,'command',1)))).flat();assert.equal(leased.length,1);
 const result={contract_version:'1.0',command_id:id,command_type:'document.get',status:'succeeded',data:{number:'INV-1'}};
 const body={contract_version:'1.0',action:'result',id:row.id,lease_token:leased[0].lease_token,result};
 await assert.rejects(()=>Q.queueRpc(m.context,{...body,lease_token:randomUUID()}));
 await Q.queueRpc(m.context,body);await Q.queueRpc(m.context,body);
 assert.equal((await Q.waitCommand(m.context,id,1,1)).data.number,'INV-1');
 const other=ctx('queue',{},m.handler);Q.pinQueueConfiguration(other,{...await Q.queueConfiguration(m.context),databaseId:randomUUID()});
 assert.equal((await Q.queueRows(other,[])).length,0);
 const eventId=randomUUID();await Q.queueRpc(m.context,{contract_version:'1.0',action:'event',event_id:eventId,event_type:'document.approved',payload:{revision:'r1'}});
 const events=await Q.leaseRows(m.context,'event',10,['document.rejected']);assert.equal(events.length,0);
 const event=(await Q.leaseRows(m.context,'event',10,['document.approved']))[0];
 await assert.rejects(()=>Q.finishEvent(m.context,event.id,randomUUID()));
 await Q.finishEvent(m.context,event.id,event.lease_token,0);
 const second=(await Q.leaseRows(m.context,'event',10))[0];assert.notEqual(second.lease_token,event.lease_token);
 await assert.rejects(()=>Q.finishEvent(m.context,event.id,event.lease_token));await Q.finishEvent(m.context,second.id,second.lease_token);
 const retained = await Q.commandResult(m.context,id); assert.equal(retained.status,'succeeded');
 const pending=await Q.enqueueCommand(m.context,'capabilities.get',randomUUID(),{});assert.equal((await Q.commandResult(m.context,pending.command_id)).status,'pending');
 const old={...m.rows.find(r=>r.kind==='command'&&r.status==='completed'),id:99,createdAt:'2000-01-01T00:00:00.000Z'};m.rows.push(old);
 const oldOther={...old,id:100,database_id:randomUUID()};m.rows.push(oldOther);
 assert.equal((await Q.cleanupQueue(m.context,30)).removed,1);assert.ok(m.rows.some(r=>r.id===100));assert.ok(m.rows.some(r=>r.id===pending.id));
 await assert.rejects(()=>Q.queueRpc(m.context,{contract_version:'1.0',action:'ping',profile_id:randomUUID()}));
 for(const Credential of [Ldo1cApi,Ldo1cQueueApi]) {const credential=new Credential();const values=Credential===Ldo1cApi?direct:queue;await assert.rejects(()=>credential.authenticate(values,{url:'https://elsewhere.test'}));}
 const gateway=new Ldo1cQueueTrigger();let status,reply;
 const g=m.context;g.getResponseObject=()=>({status:code=>{status=code;return {json:value=>{reply=value;}};}});g.getHeaderData=()=>({'x-ldo-queue-token':'wrong'});g.getBodyData=()=>({contract_version:'1.0',action:'ping',database_id:queue.databaseId,profile_id:queue.profileId,policy_revision:queue.policyRevision});
 const before=g.calls.length;assert.deepEqual(await gateway.webhook.call(g),{noWebhookResponse:true});assert.equal(status,401);assert.equal(g.calls.length,before+1);
 g.getHeaderData=()=>({'x-ldo-queue-token':queue.queueToken});assert.deepEqual(await gateway.webhook.call(g),{noWebhookResponse:true});assert.equal(status,200);assert.equal(reply.status,'ok');
 console.log('Standalone transports: authentication, no MSRV fallback, command correlation, queue scope, concurrent leases, result recovery, event retries and gateway authorization passed.');
})().catch(error=>{console.error(error);process.exit(1);});
