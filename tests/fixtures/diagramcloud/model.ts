// Vendored verbatim from julian-passebecq/diagramcloud src/core/model.ts (main, fetched 2026-09-24; handoff inspected 9a27416).
// Test-only: proves DataPass projections pass DiagramCloud's real validator. Update deliberately when the native schema changes.
import { z } from 'zod';
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const id = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/, 'Use a stable lowercase ID');
const text = z.string().max(50000), short = z.string().min(1).max(160);
const visibility = z.enum(['public','private']).default('public');
const refs = z.array(id).max(1000).default([]);
const point = z.object({x:z.number().finite().min(-100000).max(100000),y:z.number().finite().min(-100000).max(100000)}).strict();
const sourceSchema = z.object({id,title:short,location:text.default(''),url:z.string().url().refine(s=>/^https?:\/\//i.test(s),'Only HTTP(S) source links').optional(),visibility}).strict();
const remoteAssetSchema=z.object({provider:z.literal('google-drive'),fileId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/,'Invalid Google Drive file ID'),fileName:short,mimeType:z.enum(['image/png','image/jpeg','image/webp']),webViewLink:z.string().url().refine(s=>/^https:\/\//i.test(s),'Drive links must use HTTPS').optional(),modifiedTime:z.string().datetime({offset:true}).optional(),size:z.string().regex(/^\d+$/).optional(),savedAt:z.string().datetime({offset:true})}).strict();
export const assetSchema = z.object({id,name:short,data:z.string().max(3*1024*1024).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,'Embedded PNG, JPEG or WebP only'),rights:z.string().max(1000),visibility,remote:remoteAssetSchema.optional()}).strict();
const baseBlock = {id,title:short,visibility,sourceIds:refs,provenance:z.enum(['source-derived','synthetic','reference','author']).default('author')};
export const blockSchema = z.discriminatedUnion('type',[
 z.object({...baseBlock,type:z.literal('text'),text}).strict(),
 z.object({...baseBlock,type:z.literal('code'),language:z.enum(['sql','python','dax','json','text']).default('text'),code:text}).strict(),
 z.object({...baseBlock,type:z.literal('table'),columns:z.array(short).min(1).max(20),rows:z.array(z.array(z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()])).max(20)).max(500)}).strict(),
 z.object({...baseBlock,type:z.literal('image'),assetId:id,caption:text.default('')}).strict(),
 z.object({...baseBlock,type:z.literal('metrics'),items:z.array(z.object({label:short,value:z.string().max(80),note:z.string().max(500).default('')}).strict()).max(12)}).strict()
]);
export const nodeSchema=z.object({id,label:short,kind:z.enum(['source','process','storage','model','report','app','control','physics','function','table']).default('process'),provider:z.string().max(80).default('Generic'),icon:z.string().max(80).default('generic'),summary:z.string().max(500).default(''),role:z.string().max(1000).default(''),status:z.enum(['idle','running','complete','warning','failed']).default('idle'),childViewId:id.optional(),blockIds:refs,sourceIds:refs,tags:z.array(z.string().max(80)).max(20).default([]),visibility}).strict();
export const edgeSchema=z.object({id,source:id,target:id,label:z.string().max(160).default(''),kind:z.enum(['batch','stream','query','control','dependency']).default('batch'),speed:z.enum(['slow','medium','fast']).default('medium'),visibility}).strict();
export const viewSchema=z.object({id,title:short,description:z.string().max(2000).default(''),nodeIds:refs,edgeIds:refs,positions:z.record(id,point).default({}),visibility}).strict();
const stepSchema=z.object({title:short,viewId:id,nodeId:id.optional(),narration:z.string().max(2000),highlightEdgeIds:refs}).strict();
export const documentSchema=z.object({schemaVersion:z.literal(1),id,revision:z.number().int().nonnegative().default(0),title:short,summary:z.string().max(3000).default(''),author:z.string().max(160).default(''),category:z.enum(['Portfolio','Reference','Blank']).default('Blank'),tags:z.array(z.string().max(80)).max(30).default([]),rootViewId:id,provenance:z.string().max(3000).default(''),privateNotes:z.string().max(10000).optional(),nodes:z.array(nodeSchema).max(500),edges:z.array(edgeSchema).max(1500),views:z.array(viewSchema).min(1).max(80),blocks:z.array(blockSchema).max(1500).default([]),assets:z.array(assetSchema).max(30).default([]),sources:z.array(sourceSchema).max(200).default([]),story:z.array(stepSchema).max(100).default([])}).strict();
export type Project=z.infer<typeof documentSchema>;
export type ProjectNode=z.infer<typeof nodeSchema>;
export type ProjectEdge=z.infer<typeof edgeSchema>;
export type ProjectView=z.infer<typeof viewSchema>;
export type EvidenceBlock=z.infer<typeof blockSchema>;
export type Asset=z.infer<typeof assetSchema>;

/** Every import and edit crosses the same structural and relational boundary. */
export function validateDocument(input:unknown):Project {
 const d=documentSchema.parse(input), errors:string[]=[];
 function ids(items:{id:string}[],kind:string){const seen=new Set<string>();for(const i of items){if(seen.has(i.id))errors.push(`Duplicate ${kind} ID: ${i.id}`);seen.add(i.id);}return seen;}
 const nodes=ids(d.nodes,'node'),edges=ids(d.edges,'edge'),views=ids(d.views,'view'),blocks=ids(d.blocks,'block'),assets=ids(d.assets,'asset'),sources=ids(d.sources,'source');
 function check(ref:string,set:Set<string>,label:string){if(!set.has(ref))errors.push(`${label}: unknown reference ${ref}`);}
 check(d.rootViewId,views,'rootViewId');
 if(d.views.find(v=>v.id===d.rootViewId)?.visibility==='private')errors.push('Root view must be public');
 for(const n of d.nodes){n.blockIds.forEach(r=>check(r,blocks,n.id));n.sourceIds.forEach(r=>check(r,sources,n.id));if(n.childViewId)check(n.childViewId,views,n.id);}
 for(const e of d.edges){check(e.source,nodes,e.id);check(e.target,nodes,e.id);}
 for(const b of d.blocks){b.sourceIds.forEach(r=>check(r,sources,b.id));if(b.type==='image')check(b.assetId,assets,b.id);if(b.type==='table'&&b.rows.some(r=>r.length!==b.columns.length))errors.push(`${b.id}: each row must match the column count`);}
 for(const v of d.views){v.nodeIds.forEach(r=>check(r,nodes,v.id));v.edgeIds.forEach(r=>check(r,edges,v.id));if(new Set(v.nodeIds).size!==v.nodeIds.length||new Set(v.edgeIds).size!==v.edgeIds.length)errors.push(`${v.id}: duplicate view membership`);for(const key of Object.keys(v.positions))if(!v.nodeIds.includes(key))errors.push(`${v.id}: position for non-member ${key}`);for(const e of d.edges.filter(e=>v.edgeIds.includes(e.id)))if(!v.nodeIds.includes(e.source)||!v.nodeIds.includes(e.target))errors.push(`${v.id}: edge ${e.id} has an endpoint outside this view`);}
 for(const s of d.story){check(s.viewId,views,'story');if(s.nodeId&&!d.views.find(v=>v.id===s.viewId)?.nodeIds.includes(s.nodeId))errors.push(`Story node ${s.nodeId} not in ${s.viewId}`);s.highlightEdgeIds.forEach(r=>{if(!d.views.find(v=>v.id===s.viewId)?.edgeIds.includes(r))errors.push(`Story edge ${r} not in ${s.viewId}`);});}
 // Data-flow cycles are legal. Recursive view expansion is not.
 const done=new Set<string>(),visiting=new Set<string>();
 function visit(viewId:string){if(visiting.has(viewId)){errors.push(`Recursive drilldown cycle at ${viewId}`);return;}if(done.has(viewId))return;visiting.add(viewId);const v=d.views.find(v=>v.id===viewId);for(const n of d.nodes.filter(n=>v?.nodeIds.includes(n.id)))if(n.childViewId)visit(n.childViewId);visiting.delete(viewId);done.add(viewId);}
 d.views.forEach(v=>visit(v.id));
 if(errors.length)throw new Error(errors.slice(0,20).join('\n'));
 return d;
}
export function parseDocument(raw:string):Project{if(new TextEncoder().encode(raw).byteLength>MAX_DOCUMENT_BYTES)throw new Error('Document exceeds the 12 MiB import limit');return validateDocument(JSON.parse(raw));}
export function clone<T>(value:T):T{return structuredClone(value);}
export function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}
export const newId=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,12)}`;
