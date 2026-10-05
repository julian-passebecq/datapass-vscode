import type { DataPassProjectManifest } from '../../../src/core/projectManifestModel';
import { intelligenceFiles, intelligenceManifest } from './projectIntelligence';
export const hubManifest: DataPassProjectManifest = {
  ...intelligenceManifest,
  project: { id:'enterprise-hub', title:'Enterprise Hub fixture', type:'dev' },
  environments: [
    {id:'sandbox-west',label:'Sandbox West',production:false,promotesTo:['qa','preview-pr-142'],owner:'fixture',regionPolicy:'EU'},
    {id:'qa',promotesTo:['staging']},{id:'preview-pr-142',ephemeral:true},{id:'staging',label:'STAGING',promotesTo:['client-live']},
    {id:'client-live',label:'Client Live',production:true,classification:'critical'}, {id:'prod',label:'PROD',production:true,enabled:false},
    {id:'foo',label:'Custom foo',predecessors:['qa']}
  ],
  repositories: Object.fromEntries(['fabric','dbx','app','infra','dbt','api','bi'].map((id,i) => [id,{label:id,path:`repos/${id}`,remote:{url:i===0?'https://dev.azure.com/fixture/Data/_git/fabric':i===1?'https://gitlab.com/fixture/dbx':`https://github.com/fixture/${id}`}}])),
  hub: { company:{id:'foil',label:'FOIL'},program:{id:'energy',label:'Energy'},dataZones:[{id:'raw',label:'RAW'},{id:'gold',label:'GOLD'}],
    providerTargets:[{id:'fabric',label:'Fabric West',cloudProvider:'Azure',platform:'Microsoft Fabric',region:'West Europe'},{id:'dbx',label:'adb-stage',cloudProvider:'Azure',platform:'Databricks'},{id:'oci',label:'OCI dev',cloudProvider:'OCI',platform:'OCI',service:'Compute'}],
    repositoryTargets:[{repoRef:'fabric',environment:'sandbox-west',targets:['fabric'],sourceFolder:'src',branchStrategy:'main',deploymentMechanism:'reviewed pipeline',components:['spark'],evidence:['fixture://target']},{repoRef:'dbx',environment:'staging',targets:['dbx']},{repoRef:'app',environment:'sandbox-west',targets:['fabric','oci']},{repoRef:'app',environment:'prod',targets:['fabric'],enabled:false}],
    bom:[{id:'DataPass',repoRef:'.',version:'fixture',sha:'a'.repeat(40),state:'candidate'}],releases:[{id:'r1',label:'Candidate',version:'fixture',sha:'a'.repeat(40)}]
  }
};
export const hubFiles: Record<string,string> = {
  ...intelligenceFiles,
  '.datapass/graph.json':JSON.stringify({...JSON.parse(intelligenceFiles['.datapass/graph.json']!),items:[...JSON.parse(intelligenceFiles['.datapass/graph.json']!).items,{id:'app-query',kind:'script',label:'App SQL',provider:'python',artifacts:{repoRef:'app',profile:'python.script',root:'.',entry:'query.sql',files:['query.sql']}}]}),
  '.datapass/project.json':JSON.stringify(hubManifest,null,2),
  '.datapass/catalog.json':JSON.stringify({format:'datapass.catalog',version:'1',projects:[{id:'contoso',title:'Contoso',organization:'Contoso',program:'Factory',repository:{url:'https://github.com/fixture/contoso'},localPath:'../portfolio/contoso'}]}),
  'portfolio/contoso/.datapass/project.json':JSON.stringify({schemaVersion:5,project:{id:'contoso',title:'Contoso'},hub:{company:{id:'contoso',label:'Contoso'},program:{id:'factory',label:'Factory'}}}),
  ...Object.fromEntries(Object.keys(hubManifest.repositories!).map(id => [`repos/${id}/query.sql`,'SELECT id FROM orders;\n']))
};
