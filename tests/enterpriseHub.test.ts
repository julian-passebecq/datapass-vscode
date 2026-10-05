import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProjectManifest as validateManifest } from '../src/core/projectManifestModel';
import { hubManifest } from './fixtures/v6/enterpriseHub';
import { environmentProblems, effectiveBindings } from '../src/core/hub/model';
import { gitHostOf } from '../src/core/project/gitHosts';
import { headCiArgs, exactHeadCi } from '../src/core/hub/ci';
import { checkSpawn } from '../src/core/spawnAllowList';
import { workOrderDag, nextReadyWork, type DagInput } from '../src/core/workOrders/dag';
import { initialState, parseWorkOrder, type WorkOrder } from '../src/core/workOrders/format';
import { hubSummary, scopeProjects, minimapRows, projectBom, hubRepositoryKey, type HubProject, type HubState } from '../src/core/hub/projection';
import { safeCompanionChoices, hubHandoff } from '../src/core/hub/routing';
import { classifyPath } from '../src/core/hub/classify';
import { fileSemanticDiff } from '../src/core/hub/semanticDiff';
import { hubHtml, inspectorHtml } from '../src/views/hubHtml';
import type { GitRepoReport } from '../src/core/git/gitReport';
import { hubOrder } from './fixtures/v6/hubOrder';
const SHA='a'.repeat(40), DIGEST='sha256:'+'b'.repeat(64);
function project(id='enterprise-hub',company='FOIL'): HubProject { return {id,title:id,company,program:'Energy',manifest:hubManifest,repositories:[{key:'.',label:'local',changedFiles:[],semantic:[],gaps:[],components:[]}],orders:[],agents:[],gaps:[],qualification:'UNKNOWN'}; }
function git(over:Partial<GitRepoReport>={}):GitRepoReport { return {key:'.',label:'local',section:'project',role:'project',state:'ok',branch:'main',head:SHA,defaultBranch:'main',worktrees:[],merges:[],hostData:{kind:'no-host'},...over}; }
function order(id:string):DagInput {
  const source=hubOrder(id);
  return {order:{...source,id,dag:{acceptance:['tests pass'],priority:10}},policyAllowed:true,digest:DIGEST};
}
test('B D-K: seven repositories, independent Git hosts/provider axes, arbitrary/disabled environments and nonlinear promotions',()=>{
  assert.deepEqual(validateManifest(hubManifest),[]);
  assert.equal(Object.keys(hubManifest.repositories!).length,7);
  assert.equal(hubManifest.environments!.some(e=>e.id==='test'),false);
  assert.equal(environmentProblems(hubManifest.environments!).length,0);
  const bindings=effectiveBindings(hubManifest);
  assert.equal(bindings.find(b=>b.environment==='prod')!.enabled,false);
  assert.equal(bindings.find(b=>b.repoRef==='app' && b.environment==='sandbox-west')!.providerTargets.length,2);
  assert.equal(gitHostOf(hubManifest.repositories!.fabric!.remote!.url)!.kind,'azure-devops');
  assert.equal(gitHostOf(hubManifest.repositories!.dbx!.remote!.url)!.kind,'gitlab');
  assert.equal(hubManifest.hub!.providerTargets![1]!.platform,'Databricks');
  assert.equal(environmentProblems([{id:'a',predecessors:['b']},{id:'b',predecessors:['a']}]).length>0,true);
  assert.equal(environmentProblems([{id:'a',promotesTo:['missing']}]).length>0,true);
});
test('invalid manifests are rejected without exceptions, including target references and source traversal',()=>{
  for(const environments of [null,{},['invalid']]) assert.doesNotThrow(()=>assert.ok(validateManifest({...hubManifest,environments}).length));
  assert.ok(validateManifest({...hubManifest,hub:{repositoryTargets:[{repoRef:'missing',environment:'foo',targets:['missing']}]}}).length);
  assert.ok(validateManifest({...hubManifest,hub:{repositoryTargets:[{repoRef:'.',environment:'foo',targets:[],sourceFolder:'../secret'}]}}).length);
});
test('M N: exact-HEAD CI fail/blocked/unknown; unrelated, skipped and truncated evidence never green',()=>{
  assert.equal(exactHeadCi('gitlab',SHA,[{id:1,sha:'c'.repeat(40),status:'success'}],'now').status,'UNKNOWN');
  assert.equal(exactHeadCi('gitlab',SHA,[{id:1,sha:SHA,status:'failed'}],'now').status,'FAIL');
  assert.equal(exactHeadCi('gitlab',SHA,[{id:1,sha:SHA,status:'manual'}],'now').status,'BLOCKED');
  assert.equal(exactHeadCi('github',SHA,[{databaseId:1,headSha:SHA,status:'completed',conclusion:'skipped'}],'now').status,'UNKNOWN');
  assert.equal(exactHeadCi('gitlab',SHA,Array.from({length:20},(_,i)=>({id:i+1,sha:SHA,status:'success'})),'now').status,'UNKNOWN');
  assert.equal(exactHeadCi('github',SHA,[{databaseId:1,headSha:SHA,status:'completed',conclusion:'failure',workflowName:'test'},{databaseId:2,headSha:SHA,status:'completed',conclusion:'success',workflowName:'build'}],'now').status,'FAIL');
});
test('head CI commands use fixed read-only routes and reject added mutation flags',()=>{
  for(const url of ['https://github.com/fixture/app','https://gitlab.com/fixture/dbx','https://dev.azure.com/fixture/Data/_git/fabric']){
    const query=headCiArgs(gitHostOf(url)!,SHA)!;assert.equal(checkSpawn(query.tool,query.args).allowed,true);
    assert.equal(checkSpawn(query.tool,[...query.args,'--method','POST']).allowed,false);
  }
});
test('DAG qualification unlocks dependencies; agent done/legacy done/digest drift/cycles do not',()=>{
  const a=order('wo-20261005-1200-aaaa'),b=order('wo-20261005-1200-bbbb');b.order.dag!.requires=[a.order.id];
  a.resultStatus='done';assert.equal(workOrderDag([a,b])[1]!.status,'BLOCKED');
  a.state={...initialState(a.order,DIGEST),status:'done'};assert.equal(workOrderDag([a,b])[1]!.status,'BLOCKED');
  a.state.qualification={at:new Date().toISOString(),digest:DIGEST,acceptance:['tests pass'],evidence:['fixture://verified'],by:'person'};
  assert.equal(workOrderDag([a,b])[1]!.status,'READY');
  a.digest='sha256:'+'c'.repeat(64);assert.equal(workOrderDag([a,b])[1]!.status,'BLOCKED');
  a.digest=DIGEST;a.order.dag!.requires=[b.order.id];assert.equal(workOrderDag([a,b]).every(r=>r.status==='BLOCKED'),true);
});
test('DAG priorities/scopes/policy and fanout are explicit; no launch occurs in pure selection',()=>{
  const a=order('wo-20261005-1200-aaaa'),b=order('wo-20261005-1200-bbbb');b.order.dag!.priority=50;
  assert.equal(nextReadyWork(workOrderDag([a,b]))!.id,b.order.id);b.policyAllowed=false;
  assert.equal(nextReadyWork(workOrderDag([a,b]))!.id,a.order.id);
  assert.equal(nextReadyWork(workOrderDag([a,b]),{project:'absent'}),undefined);
  a.order.dag!.unblocks=[b.order.id];assert.match(workOrderDag([a,b])[1]!.blockers.join(';'),/requires/);
  a.order.repositories[0]!.ref='coordination';assert.doesNotThrow(()=>parseWorkOrder(JSON.stringify(a.order)));
});
test('unreadable WorkOrder state blocks readiness even when project policy permits work',()=>{
  const a=order('wo-20261005-1200-aaaa');a.problem='state.json cannot be read';
  assert.equal(workOrderDag([a])[0]!.status,'BLOCKED');assert.equal(nextReadyWork(workOrderDag([a])),undefined);
});
test('A C L O P: local mono/multi-company scopes, agents deduplicated, detached and dirty orientation',()=>{
  const p=project(),q=project('contoso','Contoso');
  p.agents=['.','api'].map(repo=>({provider:'codex',order:'wo-a',repo,branch:'codex/a',status:'running',origin:'AGENT-REPORTED',evidence:[]}));
  p.repositories[0]!.git=git({detached:true,branch:undefined,counts:{staged:1,unstaged:1,untracked:1,conflicted:0},worktrees:[{path:'private-host-path',name:'agent-a',branch:'codex/a',head:'c'.repeat(40),detached:false,locked:false,prunable:false},{path:'private-host-path2',name:'agent-b',branch:'codex/b',head:'d'.repeat(40),detached:false,locked:false,prunable:false}]});
  assert.equal(hubSummary([p,q]).agents,1);assert.equal(scopeProjects([p,q],{company:'Contoso'}).length,1);
  assert.equal(minimapRows(p).some(r=>r.current && r.branch.startsWith('detached:')),true);
  assert.equal(minimapRows(p).filter(r=>r.worktrees>0).length,2);
});
test('BOM live revision and typed routing preserve unknowns, disabled bindings and observed-only revisions',()=>{
  const p=project();p.repositories[0]!.git=git();
  assert.equal(projectBom(p)[0]!.observation,'current');p.repositories[0]!.git!.head='c'.repeat(40);assert.equal(projectBom(p)[0]!.observation,'stale');
  p.selectedEnvironment='prod';
  const state={projects:[p],scope:{project:p.id},selectedComponent:'spark'} as HubState;
  assert.deepEqual(hubHandoff(state).providerTargets,[]);
  assert.throws(()=>hubHandoff(state,undefined,'d'.repeat(40)),/observed context/);
  p.repositories[0]!.topology=[{branch:'main',head:'e'.repeat(40),relation:'default'}];
  assert.equal(hubHandoff(state,undefined,'e'.repeat(40)).revision,'e'.repeat(40));
  assert.deepEqual(safeCompanionChoices([]),{});
  assert.equal(safeCompanionChoices(['tern.revealRevision']).lens,'tern.revealRevision');
});
test('named coordination roots and reserved order refs map to observed repositories without conflating a client repo',()=>{
  const m={...hubManifest,repositories:{root:{path:'.'},coordination:{path:'repos/coordination'}}};
  assert.equal(hubRepositoryKey(m,'root'),'.');assert.equal(hubRepositoryKey(m,'coordination-repo'),'.');
  assert.equal(hubRepositoryKey(m,'coordination'),'coordination');
});
test('semantic diff uses Common SQL/IaC primitives without execution',()=>{
  assert.equal(classifyPath('models/orders.sql'),'sql');
  const diff=fileSemanticDiff('q.sql','sql','SELECT a FROM old_table;','SELECT b FROM new_table;');assert.ok(diff.changes.length);
  assert.deepEqual(fileSemanticDiff('main.tf','iac',null,'moved { from = aws_instance.old to = aws_instance.new }').iacMoves,[{from:'aws_instance.old',to:'aws_instance.new'}]);
});
test('Hub and Inspector escape declarations, expose origins, provide unavailable companion hints and narrow controls',()=>{
  const p=project();p.title='<script>injection</script>';
  const s:HubState={projects:[p],scope:{project:p.id},companies:['FOIL'],programs:['Energy'],summary:hubSummary([p]),attention:[],minimap:true,inspector:true,minimapExpanded:true,gaps:[],companions:{}};
  const html=hubHtml(s);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>injection/);assert.match(html,/lens unavailable/);
  for(const tab of ['overview','architecture','lineage','work','git','cloud','evidence','decisions']) assert.match(html,new RegExp('data-id="'+tab+'"'));
  assert.match(inspectorHtml(s),/data-hub-inspector/);assert.match(inspectorHtml(s),/data-hub-minimap/);
  assert.doesNotMatch(inspectorHtml(s),/private-host-path/);
});
