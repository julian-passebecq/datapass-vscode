import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import type { DataPassTestApi } from '../../src/extension';
import { test,record } from './harness';
import { withUi } from './ui';
export function registerEnterpriseHubFlows(api:()=>DataPassTestApi):void {
 const fixtures=['v6-enterprise-hub'];
 test('Hub installed: multi-company portfolio, seven repos, real Git worktrees/detached/dirty and exact-HEAD fail/blocked CI',async()=>{
  await vscode.workspace.getConfiguration('datapass').update('git.ghPath',process.env.DATAPASS_IT_HUB_CI,vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('datapass').update('ai.workOrders.enabled',true,vscode.ConfigurationTarget.Global);
  await api().workOrders.reload();await api().home.open();
  await api().home.send({type:'hub',action:'refreshCI'});
  const hub=(await api().home.state()).hub!;assert.ok(hub);assert.deepEqual(hub.companies.sort(),['Contoso','FOIL']);
  const p=hub.projects.find(p=>p.id==='enterprise-hub')!;assert.equal(p.repositories.length,8);
  assert.equal(p.repositories.find(r=>r.key==='app')!.ci!.status,'FAIL');
  assert.equal(p.repositories.find(r=>r.key==='api')!.ci!.status,'BLOCKED');
  assert.equal(p.repositories.find(r=>r.key==='dbt')!.git!.detached,true);
  assert.equal(p.repositories.find(r=>r.key==='api')!.git!.worktrees.length,2);
  assert.ok(p.repositories.find(r=>r.key==='app')!.changedFiles.includes('query.sql'));
  assert.ok(p.repositories.find(r=>r.key==='app')!.semantic.length);
  assert.ok(p.repositories.find(r=>r.key==='app')!.components.includes('app-query'));
  assert.ok(p.repositories.find(r=>r.key==='api')!.topology!.some(t=>t.branch==='codex/agent-a' && t.relation==='ahead'));
  for(const r of p.repositories)if(r.ci?.status==='PASS')assert.equal(r.ci.sha,r.git!.head);
  for(const tab of ['overview','architecture','lineage','work','git','cloud','evidence','decisions']){await api().home.send({type:'hub',action:'tab',id:tab});assert.equal((await api().home.state()).hub!.scope.tab,tab);}
  await api().home.send({type:'hub',action:'scope',field:'company',id:'Contoso'});assert.equal((await api().home.state()).hub!.summary.projects,1);
  await api().home.send({type:'hub',action:'scope',field:'company',id:'FOIL'});
  await api().home.send({type:'hub',action:'project',id:'enterprise-hub'});
  const calls=fs.readFileSync(process.env.DATAPASS_IT_HUB_CI!+'.log','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));assert.ok(calls.some(c=>c.args[0]==='run'&&c.args[1]==='list'));
  record('enterpriseHubObservations',{hub,calls});
 },fixtures);
 test('Hub installed: disabled env, scope validation, optional typed companion handoffs and persisted view switches',async()=>{
  const invalid=await withUi([],()=>api().home.send({type:'environment',id:'prod'}),{allowErrors:true});assert.ok(invalid.errors.some(e=>/disabled/.test(e)));
  await api().home.send({type:'environment',id:'sandbox-west'});
  const payloads:Record<string,any>={};const subs=['datapassLens.revealRevision','cloudStudio.planDeployment','xray.inspectEvidence'].map((cmd,i)=>vscode.commands.registerCommand(cmd,p=>payloads[['lens','cloud','xray'][i]!]=p));
  try { for(const id of ['lens','cloud','xray']){await api().home.send({type:'hub',action:'companion',id,repository:'app'});assert.equal(payloads[id].schema,'datapass.hub-context/1');assert.equal(payloads[id].environment,'sandbox-west');assert.deepEqual(payloads[id].providerTargets,['fabric','oci']);assert.equal(payloads[id].revision,(await api().home.state()).hub!.projects.find(p=>p.id==='enterprise-hub')!.repositories.find(r=>r.key==='app')!.git!.head);} }
  finally {subs.forEach(s=>s.dispose());}
  assert.deepEqual((await api().home.state()).hub!.companions,{});
  const absent=await withUi([],()=>api().home.send({type:'hub',action:'companion',id:'lens'}));assert.ok(absent.notices.some(e=>/unavailable/.test(e)));
  await api().home.send({type:'hub',action:'setting',id:'minimap',value:'false'});assert.equal((await api().home.state()).hub!.minimap,false);
  await vscode.commands.executeCommand('datapass.hub.hideInspector');assert.equal((await api().home.state()).hub!.inspector,false);
  await vscode.commands.executeCommand('datapass.hub.showInspector');assert.equal((await api().home.state()).hub!.inspector,true);
  await api().home.send({type:'hub',action:'setting',id:'minimap',value:'true'});
  record('hubTypedHandoffs',{payloads,absent:absent.notices});
 },fixtures);
 test('Hub installed: agent done does not unlock dependencies; person qualification records exact digest then Next READY selects without launching',async()=>{
  const id='wo-20261005-1200-aaaa',next='wo-20261005-1200-bbbb';
  const first=api().workOrders.list().find(o=>o.id===id)!;
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(first.folder,'result.json'),Buffer.from(JSON.stringify({format:'datapass.work-order-result',version:'1',orderId:id,receipt:first.order!.receipt,status:'done',summary:'Agent fixture reports tests pass'})));
  await api().workOrders.reload();
  let p=(await api().home.state()).hub!.projects.find(p=>p.id==='enterprise-hub')!;
  assert.equal(p.orders.find(o=>o.id===id)!.status,'EVIDENCE_RECEIVED');assert.equal(p.orders.find(o=>o.id===next)!.status,'BLOCKED');
  await api().home.send({type:'hub',action:'order',id});
  const qualificationUi=await withUi([{pick:['tests pass']},{input:'fixture://reviewed-test-report'}],()=>vscode.commands.executeCommand('datapass.hub.qualify'));
  const qualified=api().workOrders.list().find(o=>o.id===id)!;
  record('hubPersonQualification',{prompts:qualificationUi.prompts,state:qualified.state,stateProblem:qualified.stateProblem,digest:qualified.digestNow});
  assert.equal(qualified.stateProblem,undefined);assert.ok(qualified.state!.qualification);
  assert.equal(qualified.state!.qualification!.digest,qualified.digestNow);
  p=(await api().home.state()).hub!.projects.find(p=>p.id==='enterprise-hub')!;
  assert.equal(p.orders.find(o=>o.id===id)!.status,'QUALIFIED');assert.equal(p.orders.find(o=>o.id===next)!.status,'READY');
  await vscode.commands.executeCommand('datapass.hub.nextReady');assert.equal(api().workOrders.selected(),next);
  assert.equal(api().workOrders.list().find(o=>o.id===next)!.state!.launches.length,0);
  record('hubDagQualified',p.orders);
  // Qualification also works without an agent launch, and survives ordinary order closure.
  await withUi([{pick:['tests pass']},{input:'fixture://reviewed-next-report'}],()=>vscode.commands.executeCommand('datapass.hub.qualify'));
  assert.equal((await api().home.state()).hub!.projects.find(p=>p.id==='enterprise-hub')!.orders.find(o=>o.id===next)!.status,'QUALIFIED');
  const closed=api().workOrders.list().find(o=>o.id===id)!;
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(closed.folder,'state.json'),Buffer.from(JSON.stringify({...closed.state,status:'done'})));
  await api().workOrders.reload();
  assert.equal((await api().home.state()).hub!.projects.find(p=>p.id==='enterprise-hub')!.orders.find(o=>o.id===id)!.qualified,true);
  const nextOrder=api().workOrders.list().find(o=>o.id===next)!;const md=vscode.Uri.joinPath(nextOrder.folder,'order.md').fsPath;const stat=fs.statSync(md);
  const before=fs.readFileSync(md,'utf8'),after=before.replace('order','other');assert.notEqual(after,before);assert.equal(Buffer.byteLength(after),stat.size);
  fs.writeFileSync(md,after);fs.utimesSync(md,stat.atime,stat.mtime);
  await api().workOrders.reload();
  record('hubQualificationDrift',{recorded:api().workOrders.list().find(o=>o.id===next)!.state?.qualification?.digest,current:api().workOrders.list().find(o=>o.id===next)!.digestNow});
  assert.equal((await api().home.state()).hub!.projects.find(p=>p.id==='enterprise-hub')!.orders.find(o=>o.id===next)!.qualified,false,'same-size/time changed bytes invalidate qualification');
 },fixtures);
}
