import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyCommand, validateProject } from '../src/model.mjs';
import { Store } from '../src/store.mjs';
import { documentTemplate } from '../public/documents.js';

const fixture = () => ({id:'links',name:'按需文档',revision:1,edges:[],activity:[],
  documents:[{id:'outline',title:'大纲',type:'plan',content:'# 大纲'},
    {id:'proof',title:'验收细节',type:'verification',content:'# 证据',taskId:'a'}],
  tasks:['a','b'].map(id=>({id,title:id,status:'backlog',documentIds:['outline'],
    criteria:[{id:`check-${id}`,text:'可检验',result:'pending',evidence:''}],position:null}))});

test('free-form documents need no template or mandatory project document set',()=>{
  const p=fixture();p.documents.push({id:'custom',title:'自由大纲',type:'general',content:''});
  assert.equal(validateProject(p),p);
  assert.equal(documentTemplate('general','自由大纲'),'');
  p.documents=[];p.tasks.forEach(t=>t.documentIds=[]);assert.equal(validateProject(p),p);
});
test('acceptance document references reject missing or malformed IDs, but accept legacy and empty references',()=>{
  for(const documentId of [undefined,null,'','outline','proof']) {
    const p=fixture();if(documentId!==undefined)p.tasks[0].criteria[0].documentId=documentId;
    assert.equal(validateProject(p),p);
  }
  for(const documentId of ['missing','../../escape',0,{},['proof']]) {
    const p=fixture();p.tasks[0].criteria[0].documentId=documentId;
    assert.throws(()=>validateProject(p),/验收文档/);
  }
});
test('deleting a document only detaches its task and acceptance links, without touching results or other links',()=>{
  const p=fixture();p.tasks[0].criteria[0].documentId='proof';p.tasks[1].criteria[0].documentId='outline';
  p.tasks[0].documentIds.push('proof');const before=structuredClone(p);
  const next=applyCommand(p,{type:'deleteDocument',id:'proof'});
  assert.equal(next.tasks[0].criteria[0].documentId,null);
  assert.equal(next.tasks[0].criteria[0].text,'可检验');assert.equal(next.tasks[0].criteria[0].result,'pending');
  assert.equal(next.tasks[1].criteria[0].documentId,'outline');
  assert.deepEqual(next.tasks[0].documentIds,['outline']);assert.deepEqual(p,before);
});
test('acceptance document does not substitute for passed results or written evidence',()=>{
  const p=fixture();p.tasks[0].criteria[0].documentId='proof';
  assert.throws(()=>applyCommand(p,{type:'updateTask',id:'a',patch:{status:'done'}}),/验收/);
  p.tasks[0].criteria[0].result='passed';
  assert.throws(()=>applyCommand(p,{type:'updateTask',id:'a',patch:{status:'done'}}),/证据/);
});
test('shared project outlines and individual acceptance documents survive disk reload and import',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'document-links-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new Store(directory);await store.init();let p=await store.import(fixture());
  p=await store.command(p.id,p.revision,{type:'saveDocument',document:{id:'free',title:'自定义文档',type:'general',content:''}});
  p=await store.command(p.id,p.revision,{type:'saveAcceptanceDocument',document:{id:'acceptance-proof',taskId:'a',title:'独立验收',content:'# 验收'},criterionId:'check-a'});
  const saved=await new Store(directory).get(p.id);assert.equal(saved.tasks[0].criteria[0].acceptanceDocumentId,'acceptance-proof');
  assert.deepEqual(saved.tasks.map(t=>t.documentIds),[['outline'],['outline']]);
  const imported=await store.import(saved);assert.equal(imported.tasks[0].criteria[0].acceptanceDocumentId,'acceptance-proof');
  const next=await store.command(p.id,p.revision,{type:'deleteAcceptanceDocument',id:'acceptance-proof'});
  assert.equal((await store.get(next.id)).tasks[0].criteria[0].acceptanceDocumentId,null);
});
