import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hubFiles,hubManifest } from './enterpriseHub';
import { hubOrder } from './hubOrder';
import { initialState } from '../../../src/core/workOrders/format';
import { resolveExecutable } from '../../../src/core/exec';
const repo=process.cwd();
const gitIn=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',...args],{cwd,stdio:'ignore'});
function writeTree(root:string,files:Record<string,string>):void {for(const [rel,text] of Object.entries(files)){const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}}
function commitAll(dir:string,message:string):void {gitIn(dir,'init','-q','-b','main');gitIn(dir,'add','-A');gitIn(dir,'commit','-q','-m',message);}
export function setupHubFixture(ws:string,base:string): {workspace:string;env:Record<string,string>} {
  fs.mkdirSync(base,{recursive:true});
  writeTree(ws,hubFiles);
  for(const id of Object.keys(hubManifest.repositories!)) {
    const dir=path.join(ws,'repos',id);commitAll(dir,'Hub fixture repository');
    gitIn(dir,'remote','add','origin',hubManifest.repositories![id]!.remote!.url);
    if(id==='dbt') gitIn(dir,'checkout','-q','--detach','HEAD');
    if(id==='app') writeTree(dir,{'query.sql':'SELECT id, total FROM changed_orders;\n','untracked.sql':'SELECT id FROM draft;\n'});
    if(id==='api') {
      for(const name of ['agent-a','agent-b']) { const dest=path.join(base,name);gitIn(dir,'worktree','add','-q','-b',`codex/${name}`,dest);writeTree(dest,{[name+'.sql']:'SELECT id FROM orders;\n'});gitIn(dest,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','add','-A');gitIn(dest,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-q','-m',name); }
    }
  }
  writeTree(ws,{'.gitignore':'repos/\nportfolio/\n.datapass/local/\n'});commitAll(ws,'Hub coordination fixture');
  for(const [i,id] of ['wo-20261005-1200-aaaa','wo-20261005-1200-bbbb'].entries()) {
    const order=hubOrder(id,'api');order.repositories[0]!.localPath=path.join(ws,'repos','api');order.repositories[0]!.branch=`codex/agent-${i===0?'a':'b'}`;
    if(i===1)order.dag!.requires=['wo-20261005-1200-aaaa'];
    const dir=path.join(ws,'.datapass/local/work-orders',id);order.result.path=path.join(dir,'result.json');
    const state=initialState(order,'sha256:'+'b'.repeat(64));if(i===0){state.status='launched';state.launches=[{at:'2026-10-05T12:00:00Z',tool:'codex',surface:'terminal',how:'launched'}];}
    writeTree(dir,{'order.json':JSON.stringify(order),'order.md':'# Fixture order\n','state.json':JSON.stringify(state)});
  }
  const stub=path.join(base,'hub-ci-stub.cjs');fs.copyFileSync(path.join(repo,'tests/fixtures/v6/hub-ci-stub.cjs'),stub);
  // Synthetic hosts must not inherit this machine's authenticated glab/az clients.
  const gitExe=resolveExecutable('git');if(!gitExe)throw new Error('Git fixture executable unavailable');
  const fixturePath=[path.dirname(gitExe),path.dirname(process.execPath),...(process.env.SystemRoot ? [path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot] : [])].join(path.delimiter);
  return {workspace:ws,env:{DATAPASS_IT_HUB_CI:stub,PATH:fixturePath}};
}
