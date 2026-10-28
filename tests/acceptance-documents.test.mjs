import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,validateProject} from '../src/model.mjs';

export const fixture=()=>({id:'acceptance-test',name:'独立验收',revision:1,edges:[],activity:[],documents:[{id:'ordinary',title:'原件',type:'verification',content:'# 原件'}],tasks:['a','b'].map(id=>({id,title:`节点 ${id}`,status:'backlog',criteria:[{id:`check-${id}`,text:'流程可复现',result:'pending',evidence:''}],documentIds:[],position:null}))});
const create=p=>applyCommand(p,{type:'saveAcceptanceDocument',document:{id:'acceptance-a',taskId:'a',title:'验收记录',content:'# 验收'},criterionId:'check-a'});
test('new node incarnations are unique, immutable and legacy reads remain unchanged',()=>{
  const legacy=fixture();validateProject(legacy);assert.equal(legacy.tasks[0].instanceId,undefined);
  const first=applyCommand(legacy,{type:'createTask',task:{id:'c',title:'C',instanceId:'spoof'}});const token=first.tasks.find(t=>t.id==='c').instanceId;assert.equal(typeof token,'string');assert.notEqual(token,'spoof');
  assert.throws(()=>applyCommand(first,{type:'updateTask',id:'c',patch:{instanceId:'spoof'}}));
  const next=applyCommand(applyCommand(first,{type:'deleteTask',id:'c'}),{type:'createTask',task:{id:'c',title:'C'}});assert.notEqual(next.tasks.find(t=>t.id==='c').instanceId,token);
});
test('dedicated documents link only to the owning node and retain immutable ownership',()=>{
  const p=fixture(),next=create(p);assert.deepEqual(p,fixture());assert.deepEqual(next.documents,p.documents);
  assert.equal(next.tasks[0].criteria[0].acceptanceDocumentId,'acceptance-a');
  for(const id of ['ordinary','missing',0,{},'../../escape'])assert.throws(()=>applyCommand(next,{type:'updateTask',id:'a',patch:{criteria:[{...next.tasks[0].criteria[0],acceptanceDocumentId:id}]}}));
  assert.throws(()=>applyCommand(next,{type:'updateTask',id:'b',patch:{criteria:[{...next.tasks[1].criteria[0],acceptanceDocumentId:'acceptance-a'}]}}));
  const saved=applyCommand(next,{type:'saveAcceptanceDocument',document:{id:'acceptance-a',title:'改名',content:'新正文'}});assert.equal(saved.acceptanceDocuments[0].taskId,'a');
  for(const taskId of ['b',null,'missing'])assert.throws(()=>applyCommand(saved,{type:'saveAcceptanceDocument',document:{id:'acceptance-a',taskId,title:'移动',content:''}}));
  assert.throws(()=>applyCommand(saved,{type:'saveDocument',document:{id:'acceptance-a',title:'普通覆盖',type:'notes',content:''}}));
});
test('deletion clears shared criterion references without altering text, results or evidence',()=>{
  let p=create(fixture());p.tasks[0].criteria.push({id:'another',text:'另一个条件',result:'passed',evidence:'保留证据',acceptanceDocumentId:'acceptance-a'});
  const next=applyCommand(p,{type:'deleteAcceptanceDocument',id:'acceptance-a'});assert.equal(next.acceptanceDocuments.length,0);
  assert.deepEqual(next.tasks[0].criteria.map(c=>c.acceptanceDocumentId),[null,null]);assert.equal(next.tasks[0].criteria[1].evidence,'保留证据');assert.equal(next.tasks[0].criteria[1].result,'passed');
  assert.throws(()=>applyCommand(p,{type:'updateTask',id:'a',patch:{status:'done'}}),/验收/);
});
test('node deletion archives acceptance records without globalizing or reviving them',()=>{
  const p=create(fixture()),next=applyCommand(p,{type:'deleteTask',id:'a'});assert.equal(next.acceptanceDocuments[0].archived,true);assert.equal(next.acceptanceDocuments[0].taskId,'a');assert.equal(next.acceptanceDocuments[0].archivedTaskTitle,'节点 a');
  assert.deepEqual(next.documents,p.documents);assert.throws(()=>applyCommand(next,{type:'saveAcceptanceDocument',document:{id:'acceptance-a',title:'更改归档',content:''}}));
  const recreated=applyCommand(next,{type:'createTask',task:{id:'a',title:'同名节点'}});assert.equal(recreated.acceptanceDocuments[0].archived,true);
  assert.throws(()=>applyCommand(recreated,{type:'updateTask',id:'a',patch:{criteria:[{id:'new',text:'新验收',result:'pending',evidence:'',acceptanceDocumentId:'acceptance-a'}]}}));
});
test('legacy links remain readable, may be retained or cleared, but cannot be newly established',()=>{
  const p=fixture();p.tasks[0].criteria[0].documentId='ordinary';validateProject(p);
  assert.equal(applyCommand(p,{type:'updateTask',id:'a',patch:{criteria:[{...p.tasks[0].criteria[0],evidence:'新证据'}]}}).tasks[0].criteria[0].documentId,'ordinary');
  assert.equal(applyCommand(p,{type:'updateTask',id:'a',patch:{criteria:[{...p.tasks[0].criteria[0],documentId:null}]}}).tasks[0].criteria[0].documentId,null);
  assert.throws(()=>applyCommand(fixture(),{type:'updateTask',id:'a',patch:{criteria:[{...p.tasks[0].criteria[0]}]}}),/旧/);
  assert.throws(()=>applyCommand(fixture(),{type:'createTask',task:{id:'c',title:'c',criteria:[{...p.tasks[0].criteria[0]}]}}),/旧/);
});
test('explicit conversion copies the original atomically and subsequent edits stay independent',()=>{
  const p=fixture();p.tasks[0].criteria[0].documentId='ordinary';
  const next=applyCommand(p,{type:'convertAcceptanceDocument',taskId:'a',criterionId:'check-a',documentId:'ordinary'});
  const d=next.acceptanceDocuments[0];assert.equal(d.content,'# 原件');assert.equal(d.taskId,'a');assert.deepEqual(next.documents,p.documents);assert.equal(next.tasks[0].criteria[0].documentId,null);assert.equal(next.tasks[0].criteria[0].acceptanceDocumentId,d.id);
  assert.equal(applyCommand(next,{type:'saveDocument',document:{...next.documents[0],content:'改原件'}}).acceptanceDocuments[0].content,'# 原件');
  assert.equal(applyCommand(next,{type:'saveAcceptanceDocument',document:{...d,content:'改副本'}}).documents[0].content,'# 原件');
  for(const [taskId,criterionId,documentId] of [['b','check-b','ordinary'],['a','missing','ordinary'],['a','check-a','missing']])assert.throws(()=>applyCommand(p,{type:'convertAcceptanceDocument',taskId,criterionId,documentId}));
  assert.deepEqual(p.acceptanceDocuments,undefined);
});
test('acceptance and ordinary documents share count, content and snapshot limits',()=>{
  const p=create(fixture());p.documents=Array.from({length:999},(_,i)=>({id:`d-${i}`,title:'d',type:'notes',content:''}));validateProject(p);
  p.documents.push({id:'extra',title:'d',type:'notes',content:''});assert.throws(()=>validateProject(p));
  p.documents=[];p.acceptanceDocuments[0].content='a'.repeat(500000);validateProject(p);p.acceptanceDocuments[0].content+='a';assert.throws(()=>validateProject(p));
  const legacy=fixture();legacy.tasks[0].criteria[0].documentId='ordinary';legacy.documents.push(...Array.from({length:999},(_,i)=>({id:`d-${i}`,title:'d',type:'notes',content:''})));assert.throws(()=>applyCommand(legacy,{type:'convertAcceptanceDocument',taskId:'a',criterionId:'check-a',documentId:'ordinary'}));assert.equal(legacy.tasks[0].criteria[0].documentId,'ordinary');
});
test('acceptance views isolate scopes, escape content and render archives read-only',async()=>{
  const views=await import('../public/acceptance.js'),ordinary=await import('../public/documents.js');
  let p=create(fixture());p=applyCommand(p,{type:'saveAcceptanceDocument',document:{id:'acceptance-b',taskId:'b',title:'<img src=x onerror=alert(1)>',content:'# B'}});
  const html=views.renderAcceptanceCriteria(p,'a',p.tasks[0].criteria);assert.ok(html.includes('value="acceptance-a"'));assert.ok(!html.includes('value="acceptance-b"'));assert.ok(!html.includes('value="ordinary"'));
  assert.ok(!ordinary.renderTaskDocumentPicker(p,[]).includes('acceptance-a'));
  const editor=views.renderAcceptanceView({project:p,taskId:'b',draft:p.acceptanceDocuments[1],mode:'split'});assert.ok(editor.includes('&lt;img'));assert.ok(!editor.includes('<img'));
  const archived=applyCommand(p,{type:'deleteTask',id:'a'}),readonly=views.renderAcceptanceView({project:archived,taskId:null,draft:archived.acceptanceDocuments[0],archived:true});
  assert.ok(!readonly.includes('data-doc-action="save"'));assert.ok(!readonly.includes('id="docContent"'));assert.ok(readonly.includes('data-copy-acceptance'));
  assert.deepEqual(views.scopeAcceptanceDocuments(archived,'b').map(d=>d.id),['acceptance-b']);assert.equal(views.scopeAcceptanceDocuments(archived,'a').length,0);
  assert.ok(views.acceptanceTemplate('验收').includes('预期结果'));
});
