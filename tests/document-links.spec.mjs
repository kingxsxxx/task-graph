import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
let server,directory,base,id;
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'document-links-browser-'));
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,TASK_GRAPH_DATA:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);server.stdout.on('data',data=>{const m=data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',d=>process.stderr.write(d));});
});
test.afterAll(async()=>{if(server?.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}if(directory)await rm(directory,{recursive:true,force:true});});
async function snapshot(page){return (await page.request.get(`${base}/api/projects/${id}`)).json();}
async function command(page,command){const p=await snapshot(page);const r=await page.request.post(`${base}/api/projects/${id}/commands`,{data:{revision:p.revision,command}});expect(r.ok()).toBe(true);return r.json();}
async function save(page){await page.locator('[data-action="save"]').click();await expect(page.locator('#syncState')).toContainText('已同步');}
test.beforeEach(async({page})=>{
  id=(await(await page.request.post(base+'/api/projects',{data:{name:'按需文档'}})).json()).id;
  for(const t of ['a','b'])await command(page,{type:'createTask',task:{id:t,title:`节点 ${t}`,criteria:[{id:`check-${t}`,text:'流程可以复现',result:'pending',evidence:''}]}});
  for(const d of [{id:'outline',title:'项目大纲',type:'plan'}, {id:'design',title:'实现方案',type:'technical'}, {id:'proof',title:'流程验收',type:'verification',taskId:'a'}])await command(page,{type:'saveDocument',document:{...d,content:`# ${d.title}`}});
  for(const d of [{id:'acceptance-proof',title:'流程验收'},{id:'acceptance-outline',title:'大纲验收'}]) await command(page,{type:'saveAcceptanceDocument',document:{...d,taskId:'a',content:'# 独立验收'}});
  await page.goto(`${base}/?project=${id}`);await expect(page.locator('.task-node')).toHaveCount(2);
});
test('project documents can start blank or use an optional template',async({page})=>{
  await page.locator('#newDocSide').click();await page.locator('#modal [name="title"]').fill('我的项目大纲');
  await page.locator('#modalForm button[type="submit"]').click();await expect(page.locator('#docContent')).toHaveValue('');
  await page.locator('#docContent').fill('# 自己编写的大纲');await page.keyboard.press('Control+s');await expect(page.locator('#syncState')).toContainText('已同步');
  await page.locator('#newDocSide').click();await page.locator('#modal [name="title"]').fill('空白计划');await page.locator('#modal [name="type"]').selectOption('plan');
  await page.locator('#modal [name="template"]').uncheck();await page.locator('#modalForm button[type="submit"]').click();await expect(page.locator('#docContent')).toHaveValue('');
  expect((await snapshot(page)).documents.find(d=>d.title==='我的项目大纲').content).toBe('# 自己编写的大纲');
});
test('collapsed document picker shares one outline across nodes and persists independent selections',async({page})=>{
  await page.locator('[data-task="a"]').click();const picker=page.locator('[data-document-picker]');
  await expect(page.locator('[data-doc-link="outline"]')).toBeHidden();await picker.locator('summary').click();
  await page.locator('[data-doc-link="outline"]').check();await page.locator('[data-doc-link="design"]').check();
  await expect(picker.locator('summary')).toContainText('2');await picker.locator('summary').click();await expect(page.locator('[data-doc-link="outline"]')).toBeHidden();await save(page);
  await page.locator('[data-task="b"]').click();await picker.locator('summary').click();await page.locator('[data-doc-link="outline"]').check();await save(page);
  expect((await snapshot(page)).tasks.map(t=>t.documentIds)).toEqual([['outline','design'],['outline']]);
  await page.reload();await page.locator('[data-task="a"]').click();await picker.locator('summary').click();await expect(page.locator('[data-doc-link="outline"]')).toBeChecked();await expect(page.locator('[data-doc-link="design"]')).toBeChecked();
});
test('each acceptance item can choose, open, replace or detach its own document',async({page})=>{
  await page.locator('[data-task="a"]').click();const choice=page.getByLabel('第 1 项验收文档',{exact:true});
  await choice.selectOption('acceptance-proof');await page.getByLabel('第 1 项验收证据',{exact:true}).fill('仍需手动验收');await save(page);
  expect((await snapshot(page)).tasks[0].criteria[0]).toMatchObject({acceptanceDocumentId:'acceptance-proof',result:'pending',evidence:'仍需手动验收'});
  await page.reload();await page.locator('[data-task="a"]').click();await expect(choice).toHaveValue('acceptance-proof');
  await page.getByRole('button',{name:'打开验收文档 流程验收',exact:true}).click();await expect(page.locator('#docTitle')).toHaveValue('流程验收');
  await page.locator('[data-doc-return]').click();await expect(page.locator('[data-task="a"]')).toHaveAttribute('aria-pressed','true');
  await choice.selectOption('acceptance-outline');await save(page);expect((await snapshot(page)).tasks[0].criteria[0].acceptanceDocumentId).toBe('acceptance-outline');
  await choice.selectOption('');await save(page);expect((await snapshot(page)).tasks[0].criteria[0].acceptanceDocumentId).toBe(null);
});
test('deleting an acceptance document clears the reference but keeps the criterion and evidence',async({page})=>{
  await command(page,{type:'updateTask',id:'a',patch:{criteria:[{id:'check-a',text:'流程可以复现',result:'passed',evidence:'测试结果',acceptanceDocumentId:'acceptance-proof'}]}});
  await page.reload();await page.locator('[data-task="a"]').click();await page.getByRole('button',{name:'打开验收文档 流程验收',exact:true}).click();
  page.once('dialog',d=>d.accept());await page.locator('[data-doc-action="delete"]').click();await expect(page.locator('#syncState')).toContainText('已同步');await page.locator('[data-doc-return]').click();
  await expect(page.getByLabel('第 1 项验收文档',{exact:true})).toHaveValue('');await expect(page.getByLabel('第 1 项验收证据',{exact:true})).toHaveValue('测试结果');
  expect((await snapshot(page)).tasks[0].criteria[0]).toMatchObject({acceptanceDocumentId:null,text:'流程可以复现',result:'passed',evidence:'测试结果'});
});
test('scrolling document choices stays inside the picker, including mobile and both themes',async({page})=>{
  for(let i=0;i<12;i++)await command(page,{type:'saveDocument',document:{id:`extra-${i}`,title:`其他文档 ${i}`,type:'notes',content:''}});
  await page.reload();await page.locator('[data-task="a"]').click();const picker=page.locator('[data-document-picker]');await picker.locator('summary').click();
  const list=picker.locator('.document-picker-options');expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await page.locator('[data-doc-link="extra-11"]').check();await save(page);await page.locator('#themeToggle').selectOption('light');await page.setViewportSize({width:390,height:844});
  await picker.locator('summary').click();await expect(page.locator('[data-doc-link="extra-11"]')).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect.poll(async()=>{const box=await page.locator('#sidebar').boundingBox();return Math.round(box.x+box.width);}).toBeLessThanOrEqual(0);
  await page.screenshot({path:'test-results/document-picker-mobile-light.png',fullPage:true});
  await picker.locator('summary').focus();await page.keyboard.press('Escape');await expect(picker).not.toHaveAttribute('open','');
});
test('remote document deletion removes stale references without losing dirty acceptance edits',async({page})=>{
  await command(page,{type:'updateTask',id:'a',patch:{documentIds:['outline'],criteria:[{id:'check-a',text:'流程可以复现',result:'pending',evidence:'',acceptanceDocumentId:'acceptance-proof'}]}});
  await page.reload();await page.locator('[data-task="a"]').click();await page.getByLabel('第 1 项验收证据',{exact:true}).fill('删除期间保留的本地证据');
  await command(page,{type:'deleteAcceptanceDocument',id:'acceptance-proof'});await command(page,{type:'deleteDocument',id:'outline'});
  await page.locator('#syncState').click();await expect(page.getByLabel('第 1 项验收文档',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('第 1 项验收证据',{exact:true})).toHaveValue('删除期间保留的本地证据');
  await save(page);const p=await snapshot(page);
  expect(p.tasks[0].criteria[0]).toMatchObject({acceptanceDocumentId:null,evidence:'删除期间保留的本地证据',result:'pending'});expect(p.tasks[0].documentIds).toEqual([]);
});
test('two acceptance items keep independent document choices when criteria are added and removed',async({page})=>{
  await page.locator('[data-task="a"]').click();await page.getByLabel('第 1 项验收文档',{exact:true}).selectOption('acceptance-proof');
  await page.locator('[data-action="addCriterion"]').click();await page.getByLabel('第 2 项验收标准',{exact:true}).fill('第二个独立条件');
  await page.getByLabel('第 2 项验收文档',{exact:true}).selectOption('acceptance-outline');await save(page);
  expect((await snapshot(page)).tasks[0].criteria.map(c=>c.acceptanceDocumentId)).toEqual(['acceptance-proof','acceptance-outline']);
  await page.getByRole('button',{name:'删除第 1 项验收标准',exact:true}).click();await save(page);
  await page.reload();await page.locator('[data-task="a"]').click();await expect(page.getByLabel('第 1 项验收文档',{exact:true})).toHaveValue('acceptance-outline');
});
