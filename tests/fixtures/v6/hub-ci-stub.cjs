// Qualification fixture only: offline host responses; actual repository HEAD read from local Git.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const args=process.argv.slice(2);
fs.appendFileSync(__filename+'.log',JSON.stringify({args,cwd:process.cwd()})+'\n');
if(args[0]==='auth'&&args[1]==='status')process.exit(0);
if(args[0]==='pr'&&args[1]==='list'){console.log('[]');process.exit(0);}
if(args[0]==='repo'&&args[1]==='view'){console.log('{"visibility":"PRIVATE"}');process.exit(0);}
if(args[0]==='run'&&args[1]==='list'){
 const head=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const repo=path.basename(process.cwd());
 const conclusion=repo==='app'?'failure':repo==='api'?'action_required':'success';
 console.log(JSON.stringify([{databaseId:100,headSha:head,status:'completed',conclusion,workflowName:'fixture-exact-head'},{databaseId:101,headSha:'f'.repeat(40),status:'completed',conclusion:'success',workflowName:'unrelated-head'}]));process.exit(0);
}
console.error('Unexpected fixture host command');process.exit(2);
