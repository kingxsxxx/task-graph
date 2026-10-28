import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/http.mjs';

async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'node-doc-storage-')),store=new Store(dir); await store.init();
  t.after(()=>rm(dir,{recursive:true,force:true})); let p=await store.create({name:'文档存储'});
  for(const id of ['a','b','empty']) p=await store.command(p.id,p.revision,{type:'createTask',task:{id,title:'同名 / 中文'}});
  return {dir,store,p};
}
async function save(store,p,id,taskId=null) {
  return store.command(p.id,p.revision,{type:'saveDocument',document:{id,title:'重名 / 文档',type:'notes',content:`# ${id}`,taskId}});
}
test('owned Markdown occupies separate real folders including empty tasks',async t=>{
  let {store,p}=await setup(t); p=await save(store,p,'g');p=await save(store,p,'da','a');p=await save(store,p,'db','b');
  const s=await store.storage(p.id); assert.equal(s.revision,p.revision);
  for(const d of s.documents) { assert.equal(await readFile(d.path,'utf8'),`# ${d.documentId}`); assert.ok(d.path.endsWith(d.taskId ? `/tasks/${d.taskId}/documents/${d.documentId}.md` : `/documents/${d.documentId}.md`)); }
  for(const folder of s.tasks){assert.equal(folder.exists,true);await access(folder.path);}
  const old=s; p=await store.command(p.id,p.revision,{type:'updateTask',id:'a',patch:{title:'改名'}});
  const newer=await store.storage(p.id);assert.notEqual(newer.generation,old.generation);assert.ok(newer.tasks[0].path.endsWith('/tasks/a/documents'));
  assert.equal((await new Store(store.directory).get(p.id)).documents.length,3);
  const imported=await store.import(p),is=await store.storage(imported.id);assert.notEqual(is.projectId,p.id);assert.ok(is.documents.every(d=>d.path.includes(imported.id)));
  p=await store.command(p.id,p.revision,{type:'deleteTask',id:'a'});const ds=await store.storage(p.id);
  assert.equal(await readFile(ds.documents.find(d=>d.documentId==='da').path,'utf8'),'# da');
  assert.equal(ds.documents.find(d=>d.documentId==='da').taskId,null);
  assert.equal(await readFile(old.documents.find(d=>d.documentId==='da').path,'utf8'),'# da');
  await assert.rejects(access(join(ds.projectFolder.path,'..','tasks','a')));
});
test('legacy snapshots return absent node folders without rewriting HEAD',async t=>{
  const {dir,store,p}=await setup(t),root=join(dir,'projects',p.id),gen='legacy';
  await mkdir(join(root,'revisions',gen,'documents'),{recursive:true});await writeFile(join(root,'revisions',gen,'snapshot.json'),JSON.stringify(p));await writeFile(join(root,'HEAD'),gen);
  const s=await store.storage(p.id);assert.equal(s.generation,'legacy');assert.ok(s.tasks.every(f=>!f.exists));assert.equal(await readFile(join(root,'HEAD'),'utf8'),'legacy');
});
test('storage paths stay paired with the one HEAD read even if a new commit wins',async t=>{
  const {store,p}=await setup(t);const read=store.readCommitted.bind(store);let changed=false;
  store.readCommitted=async id=>{const result=await read(id);if(!changed){changed=true;const next=structuredClone(result.project);next.revision++;await store.commit(next);}return result;};
  const s=await store.storage(p.id);assert.equal(s.revision,p.revision);assert.ok(s.tasks.every(f=>f.path.includes(`/revisions/${s.generation}/`)));assert.equal((await store.get(p.id)).revision,p.revision+1);
});
test('artifact failure leaves original HEAD and snapshot readable',async t=>{
  const {store,p}=await setup(t);const original=await store.get(p.id);const before=await readFile(join(store.directory,'projects',p.id,'HEAD'),'utf8');
  const write=store.writeArtifacts.bind(store);store.writeArtifacts=async(...args)=>{await write(...args);throw new Error('injected disk failure');};
  await assert.rejects(save(store,p,'failed','a'),/disk failure/);assert.equal(await readFile(join(store.directory,'projects',p.id,'HEAD'),'utf8'),before);assert.deepEqual(await store.get(p.id),original);
});
test('storage API serves current paths and rejects arbitrary files and unknown IDs',async t=>{
  const {store,p}=await setup(t),app=createApp(store);await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));const base=`http://127.0.0.1:${app.address().port}`;
  const r=await fetch(`${base}/api/projects/${p.id}/storage`);assert.equal(r.status,200);assert.equal((await r.json()).revision,p.revision);
  for(const path of ['/api/projects/missing/storage','/api/projects/%2e%2e%2fescape/storage','/src/store.mjs']) assert.equal((await fetch(base+path)).status,404);
});
