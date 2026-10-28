import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, applyCommand } from '../src/model.mjs';

const task = id => ({id,title:id,status:'backlog',criteria:[],documentIds:[],position:null});
const project = () => ({id:'owned-test',name:'节点文档',revision:1,tasks:[task('a'),task('b')],edges:[],documents:[],activity:[]});
const doc = (id, taskId = null) => ({id,title:id,type:'notes',content:'# 内容',taskId});

test('owned documents preserve ownership when a legacy client omits taskId', () => {
  const p = applyCommand(project(), {type:'saveDocument',document:doc('doc-a','a')});
  assert.equal(p.documents[0].taskId, 'a');
  const next = applyCommand(p, {type:'saveDocument',document:{id:'doc-a',title:'改名',type:'technical',content:'# 技术'}});
  assert.equal(next.documents[0].taskId, 'a');
  assert.throws(() => applyCommand(next, {type:'saveDocument',document:doc('doc-a','b')}));
  assert.throws(() => applyCommand(next, {type:'saveDocument',document:doc('doc-a',null)}));
});
test('document owners and types are validated while old snapshots remain valid', () => {
  for (const owner of [undefined,null,'a']) for (const type of ['plan','roadmap','notes','technical','verification']) {
    const p = project(); p.documents = [{...doc('d',owner),type}]; assert.equal(validateProject(p),p);
  }
  for (const owner of ['unknown','../../escape','',0,{}]) {
    const p = project(); p.documents = [doc('d',owner)]; assert.throws(() => validateProject(p));
  }
  const p = project(); p.documents = [{...doc('d'),type:'bad'}]; assert.throws(() => validateProject(p));
});
test('deleting an owner retains documents and other nodes references', () => {
  const p = project(); p.documents = [doc('d','a')]; p.tasks[1].documentIds = ['d']; p.edges = [{from:'a',to:'b'}];
  const next = applyCommand(p,{type:'deleteTask',id:'a'});
  assert.equal(next.documents[0].taskId,null); assert.equal(next.documents[0].content,p.documents[0].content);
  assert.deepEqual(next.tasks[0].documentIds,['d']); assert.deepEqual(next.edges,[]); assert.equal(p.documents[0].taskId,'a');
});
test('1000 documents are supported without increasing content and reference limits', () => {
  const p = project(); p.documents = Array.from({length:1000},(_,i)=>doc(`d-${i}`)); validateProject(p);
  p.documents.push(doc('extra')); assert.throws(()=>validateProject(p));
  p.documents = [{...doc('d'),content:'a'.repeat(500001)}]; assert.throws(()=>validateProject(p));
  p.documents = Array.from({length:101},(_,i)=>doc(`d-${i}`)); p.tasks[0].documentIds = p.documents.map(d=>d.id); assert.throws(()=>validateProject(p));
});
test('40 generated DAG and ownership combinations remain valid and lossless after deletion', () => {
  for(let seed=1;seed<=40;seed++) {
    const p = project(); p.tasks = Array.from({length:12},(_,i)=>task(`n-${i}`));
    for(let i=0;i<12;i++) for(let j=i+1;j<12;j++) if((i*17+j*31+seed)%7===0) p.edges.push({from:`n-${i}`,to:`n-${j}`});
    p.documents = p.tasks.map((t,i)=>doc(`d-${i}`,i%3 ? t.id : null));
    p.tasks.forEach((t,i)=>{t.documentIds=[`d-${(i+seed)%12}`];});
    const original = structuredClone(p), removed=`n-${seed%12}`, next=applyCommand(p,{type:'deleteTask',id:removed});
    validateProject(next); assert.deepEqual(p,original); assert.equal(next.documents.length,p.documents.length);
    assert.ok(next.documents.every(d=>d.taskId==null || next.tasks.some(t=>t.id===d.taskId)));
    assert.ok(next.tasks.every(t=>t.documentIds.every(id=>next.documents.some(d=>d.id===id))));
  }
});
test('document scopes and templates render only their own escaped files',async()=>{
  const {scopeDocuments,documentTemplate,renderDocumentView,renderNodeDocuments}=await import('../public/documents.js');
  const p=project();p.documents=[doc('g'),doc('da','a'),doc('db','b')];p.tasks.push(task('empty'));
  assert.deepEqual(scopeDocuments(p).map(d=>d.id),['g']);assert.deepEqual(scopeDocuments(p,'a').map(d=>d.id),['da']);assert.deepEqual(scopeDocuments(p,'empty'),[]);
  p.documents[1].title='<img src=x onerror=alert(1)>';
  const html=renderDocumentView({project:p,taskId:'a',draft:p.documents[1],mode:'split'});
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('data-open-doc="da"'));assert.ok(!html.includes('data-open-doc="db"'));
  for(const [type,heading] of [['plan','目标'],['roadmap','步骤'],['technical','实现'],['verification','证据'],['notes','下一步']]) assert.ok(documentTemplate(type,'标题').includes(heading));
  const node=renderNodeDocuments(p,'a');assert.ok(node.includes('da'));assert.ok(!node.includes('data-open-doc="g"'));
  assert.ok(!renderNodeDocuments(p,'empty').includes('data-open-doc='));
});
