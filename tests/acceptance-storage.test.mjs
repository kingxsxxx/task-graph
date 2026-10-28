import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.mjs';
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'acceptance-storage-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new Store(dir);await store.init();let p=await store.create({name:'独立文件'});for(const id of ['a','b'])p=await store.command(p.id,p.revision,{type:'createTask',task:{id,title:id,criteria:[{id:`check-${id}`,text:'通过测试',result:'pending',evidence:''}]}});return {store,p,dir};}
const save=(store,p)=>store.command(p.id,p.revision,{type:'saveAcceptanceDocument',document:{id:'acceptance-a',taskId:'a',title:'验收',content:'# 正文'},criterionId:'check-a'});
test('acceptance files, empty folders, archives and imported snapshots occupy separate real paths',async t=>{
  let {store,p}=await setup(t);p=await save(store,p);const paths=await store.storage(p.id);
  assert.ok(paths.acceptanceDocuments[0].path.endsWith('/tasks/a/acceptance/acceptance-a.md'));assert.equal(await readFile(paths.acceptanceDocuments[0].path,'utf8'),'# 正文');assert.ok(paths.acceptanceFolders.tasks.every(f=>f.exists));
  assert.equal((await new Store(store.directory).get(p.id)).tasks[0].criteria[0].acceptanceDocumentId,'acceptance-a');
  const imported=await store.import(p);assert.notEqual(imported.id,p.id);assert.equal((await store.storage(imported.id)).acceptanceDocuments[0].taskId,'a');
  p=await store.command(p.id,p.revision,{type:'deleteTask',id:'a'});const archived=await store.storage(p.id);assert.ok(archived.acceptanceDocuments[0].path.endsWith('/archived-tasks/a/acceptance/acceptance-a.md'));assert.equal(await readFile(archived.acceptanceDocuments[0].path,'utf8'),'# 正文');assert.equal(archived.acceptanceFolders.archived[0].title,'a');
});
test('legacy storage lookups do not create acceptance directories or rewrite HEAD',async t=>{
  const {store,p,dir}=await setup(t),root=join(dir,'projects',p.id);await mkdir(join(root,'revisions','legacy'),{recursive:true});await writeFile(join(root,'revisions','legacy','snapshot.json'),JSON.stringify(p));await writeFile(join(root,'HEAD'),'legacy');
  const paths=await store.storage(p.id);assert.ok(paths.acceptanceFolders.tasks.every(f=>!f.exists));assert.equal(await readFile(join(root,'HEAD'),'utf8'),'legacy');assert.equal(await readFile(join(root,'revisions','legacy','snapshot.json'),'utf8'),JSON.stringify(p));
});
test('acceptance paths are paired with one HEAD read during a competing commit',async t=>{
  const {store,p}=await setup(t);const read=store.readCommitted.bind(store);let changed=false;store.readCommitted=async id=>{const r=await read(id);if(!changed){changed=true;const next=structuredClone(r.project);next.revision++;await store.commit(next);}return r;};
  const paths=await store.storage(p.id);assert.equal(paths.revision,p.revision);assert.ok(paths.acceptanceFolders.tasks.every(f=>f.path.includes(paths.generation)));assert.equal((await store.get(p.id)).revision,p.revision+1);
});
test('failed and stale conversions leave originals, links and HEAD intact',async t=>{
  const {store,p}=await setup(t);const legacy=structuredClone(p);legacy.documents=[{id:'original',title:'原件',type:'notes',content:'# 原件'}];legacy.tasks[0].criteria[0].documentId='original';let imported=await store.import(legacy);
  const convert={type:'convertAcceptanceDocument',taskId:'a',criterionId:'check-a',documentId:'original'},head=await readFile(join(store.directory,'projects',imported.id,'HEAD'),'utf8');
  await assert.rejects(store.command(imported.id,0,convert),e=>e.status===409);
  const write=store.writeArtifacts.bind(store);store.writeArtifacts=async(...args)=>{await write(...args);throw new Error('disk failure');};await assert.rejects(store.command(imported.id,imported.revision,convert),/disk failure/);
  assert.equal(await readFile(join(store.directory,'projects',imported.id,'HEAD'),'utf8'),head);assert.deepEqual(await store.get(imported.id),imported);
  store.writeArtifacts=write;imported=await store.command(imported.id,imported.revision,convert);assert.equal(imported.documents[0].content,'# 原件');assert.equal(imported.acceptanceDocuments[0].content,'# 原件');
});
