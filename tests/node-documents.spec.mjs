import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
let server,directory,base,id;
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'node-doc-browser-'));
  server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,TASK_GRAPH_DATA:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);server.stdout.on('data',data=>{const m=data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',d=>process.stderr.write(d));});
});
test.afterAll(async()=>{if(server?.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}if(directory)await rm(directory,{recursive:true,force:true});});
async function command(page,command){const p=await(await page.request.get(`${base}/api/projects/${id}`)).json();const r=await page.request.post(`${base}/api/projects/${id}/commands`,{data:{revision:p.revision,command}});expect(r.ok()).toBe(true);return r.json();}
test.beforeEach(async({page})=>{
  const r=await page.request.post(base+'/api/projects',{data:{name:'节点文档测试'}});id=(await r.json()).id;
  for(const t of ['a','b'])await command(page,{type:'createTask',task:{id:t,title:`节点 ${t}`}});
  await command(page,{type:'saveDocument',document:{id:'global',title:'全局方案',type:'plan',content:'# 全局'}});
  await page.goto(`${base}/?project=${id}`);await expect(page.locator('.task-node')).toHaveCount(2);
});
async function createOwned(page,owner='a'){
  await page.locator(`[data-task="${owner}"]`).click();await page.locator(`[data-node-doc-new="${owner}"]`).click();
  await page.locator('#modal [name="title"]').fill('开发路线');await page.locator('#modal [name="type"]').selectOption('roadmap');await page.locator('#modalForm button[type="submit"]').click();
  await expect(page.locator('#documentScope')).toHaveValue(owner);await expect(page.locator('#docContent')).toContainText('步骤');
  return (await(await page.request.get(`${base}/api/projects/${id}`)).json()).documents.find(d=>d.taskId===owner);
}
test('node folders create real files, isolate scopes, reopen and return to the node',async({page})=>{
  const d=await createOwned(page);await page.locator('#docContent').fill('# 实际开发路线\n\n完整细节');await page.keyboard.press('Control+s');await expect(page.locator('#syncState')).toContainText('已同步');
  const s=await(await page.request.get(`${base}/api/projects/${id}/storage`)).json();expect(await readFile(s.documents.find(x=>x.documentId===d.id).path,'utf8')).toContain('完整细节');
  await page.locator('[data-doc-return]').click();await expect(page.locator('#inspector')).toBeVisible();await expect(page.locator('[data-task="a"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-doc-folder="a"]').click();await expect(page.locator('#docContent')).toContainText('完整细节');
  await page.locator('#documentScope').selectOption('b');await expect(page.locator('#docContent')).toHaveCount(0);
  await page.locator('[data-view="documents"]').click();await expect(page.locator('#documentScope')).toHaveValue('');await expect(page.locator('#docTitle')).toHaveValue('全局方案');
  await page.reload();await page.locator('[data-task="a"]').click();await page.locator('[data-doc-folder="a"]').click();await expect(page.locator('#docContent')).toContainText('完整细节');
});
test('folder changes guard drafts while same-document, modes and theme keep edits',async({page})=>{
  const d=await createOwned(page);await page.locator('#docContent').fill('# 未保存细节');page.once('dialog',x=>x.dismiss());await page.locator('#documentScope').selectOption('b');
  await expect(page.locator('#documentScope')).toHaveValue('a');await expect(page.locator('#docContent')).toHaveValue('# 未保存细节');
  await page.locator(`#documentsView [data-open-doc="${d.id}"]`).click();await page.locator('#themeToggle').selectOption('light');await page.locator('[data-doc-mode="preview"]').click();await page.locator('[data-doc-mode="split"]').click();await expect(page.locator('#docContent')).toHaveValue('# 未保存细节');
  await page.waitForResponse(r=>r.url()===base+'/api/projects'&&r.request().method()==='GET');await expect(page.locator('#docContent')).toHaveValue('# 未保存细节');
});
test('deleted owner retains dirty document globally and return handles vanished node',async({page})=>{
  const d=await createOwned(page);await page.locator('#docContent').fill('# 保留编辑');await command(page,{type:'deleteTask',id:'a'});await page.locator('#syncState').click();
  await expect(page.locator('#documentScope')).toHaveValue('');await expect(page.locator('#docContent')).toHaveValue('# 保留编辑');await page.locator('[data-doc-action="save"]').click();
  const p=await(await page.request.get(`${base}/api/projects/${id}`)).json();expect(p.documents.find(x=>x.id===d.id).taskId).toBe(null);expect(p.documents.find(x=>x.id===d.id).content).toBe('# 保留编辑');
  await page.locator('[data-doc-return]').click();await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#toast')).toContainText('删除');
});
test('deleted document restoration requires confirmation and produces a new ID',async({page})=>{
  const d=await createOwned(page);await page.locator('#docContent').fill('# 恢复内容');await command(page,{type:'deleteDocument',id:d.id});await page.locator('#syncState').click();
  page.once('dialog',x=>x.dismiss());await page.locator('[data-doc-action="save"]').click();expect((await(await page.request.get(`${base}/api/projects/${id}`)).json()).documents.some(x=>x.id===d.id)).toBe(false);
  page.once('dialog',x=>x.accept());await page.locator('[data-doc-action="save"]').click();await expect(page.locator('#syncState')).toContainText('已同步');
  const p=await(await page.request.get(`${base}/api/projects/${id}`)).json(),restored=p.documents.find(x=>x.content==='# 恢复内容');expect(restored.id).not.toBe(d.id);expect(restored.taskId).toBe('a');
});
test('path dialog and scoped docs stay usable in both themes and mobile',async({page})=>{
  await createOwned(page);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'docs/preview-node-documents-dark.png',fullPage:true,animations:'disabled'});
  await page.locator('#themeToggle').selectOption('light');await page.screenshot({path:'docs/preview-node-documents-light.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-doc-storage]').click();await expect(page.locator('#folderPath')).toHaveValue(/\/tasks\/a\/documents$/);await page.locator('#copyFolderPath').click();await expect(page.locator('#folderPath')).toHaveValue(/\/tasks\/a\/documents$/);await page.locator('#modalClose').click();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'docs/preview-node-documents-mobile.png',fullPage:true,animations:'disabled'});await page.locator('[data-doc-return]').click();await expect(page.locator('#inspector')).toBeVisible();
});
test('owned document revision conflict preserves edits and confirms shared-field overwrite',async({page})=>{
  const d=await createOwned(page);await page.locator('#docContent').fill('# 我的修改');
  await command(page,{type:'saveDocument',document:{...d,content:'# 代理修改',title:'代理新标题'}});
  await page.locator('[data-doc-action="save"]').click();await expect(page.locator('#syncState')).toContainText('冲突');await expect(page.locator('#docContent')).toHaveValue('# 我的修改');
  await page.locator('#syncState').click();await expect(page.locator('#docTitle')).toHaveValue('代理新标题');
  page.once('dialog',x=>x.dismiss());await page.locator('[data-doc-action="save"]').click();await expect(page.locator('#docContent')).toHaveValue('# 我的修改');
  page.once('dialog',x=>x.accept());await page.locator('[data-doc-action="save"]').click();await expect(page.locator('#syncState')).toContainText('已同步');
  const p=await(await page.request.get(`${base}/api/projects/${id}`)).json(),saved=p.documents.find(x=>x.id===d.id);expect(saved.content).toBe('# 我的修改');expect(saved.title).toBe('代理新标题');expect(saved.taskId).toBe('a');
});
test('restoration after document and owner deletion falls back to global without losing draft',async({page})=>{
  const d=await createOwned(page);await page.locator('#docContent').fill('# 双重删除后的草稿');
  await command(page,{type:'deleteTask',id:'a'});await command(page,{type:'deleteDocument',id:d.id});await page.locator('#syncState').click();await expect(page.locator('#documentScope')).toHaveValue('');
  await page.locator('[data-doc-storage]').click();await page.locator('#modalClose').click();await expect(page.locator('#docContent')).toHaveValue('# 双重删除后的草稿');
  page.once('dialog',x=>x.accept());await page.locator('[data-doc-action="save"]').click();await expect(page.locator('#syncState')).toContainText('已同步');
  const p=await(await page.request.get(`${base}/api/projects/${id}`)).json(),saved=p.documents.find(x=>x.content==='# 双重删除后的草稿');expect(saved.taskId).toBe(null);expect(saved.id).not.toBe(d.id);
});
test('clean refresh and remote polling keep the selected second document',async({page})=>{
  const d=await createOwned(page);
  await command(page,{type:'saveDocument',document:{id:'second',taskId:'a',title:'第二份细节',type:'technical',content:'# 第二份'}});
  await page.locator('#syncState').click();await page.locator('#documentsView [data-open-doc="second"]').click();
  await expect(page.locator('#docTitle')).toHaveValue('第二份细节');await page.locator('#syncState').click();await expect(page.locator('#docTitle')).toHaveValue('第二份细节');
  await command(page,{type:'saveDocument',document:{...d,title:'代理更新第一份'}});
  await expect(page.locator('#documentsView [data-open-doc="'+d.id+'"]')).toContainText('代理更新第一份',{timeout:10000});await expect(page.locator('#docTitle')).toHaveValue('第二份细节');
});
test('cancelling document creation leaves the current editor draft writable and selected',async({page})=>{
  await createOwned(page);await command(page,{type:'saveDocument',document:{id:'second',taskId:'a',title:'第二份细节',type:'technical',content:'# 第二份'}});
  await page.locator('#syncState').click();await page.locator('#documentsView [data-open-doc="second"]').click();
  await page.locator('#documentsView [data-doc-action="new"]').click();await page.locator('#modalCancel').click();
  await page.locator('#docContent').fill('# 取消后继续写');await expect(page.locator('#syncState')).toContainText('未保存');
  await page.locator('[data-doc-mode="preview"]').click();await page.locator('[data-doc-mode="split"]').click();await expect(page.locator('#docContent')).toHaveValue('# 取消后继续写');await expect(page.locator('#docTitle')).toHaveValue('第二份细节');
  await page.keyboard.press('Control+s');await expect(page.locator('#syncState')).toContainText('已同步');
  const p=await(await page.request.get(`${base}/api/projects/${id}`)).json();expect(p.documents.find(d=>d.id==='second').content).toBe('# 取消后继续写');
  await page.locator('#newDocSide').click();await page.locator('#modalCancel').click();await page.locator('#docContent').fill('# 侧栏取消也可编辑');await page.keyboard.press('Control+s');await expect(page.locator('#syncState')).toContainText('已同步');
  const next=await(await page.request.get(`${base}/api/projects/${id}`)).json();expect(next.documents.find(d=>d.id==='second').content).toBe('# 侧栏取消也可编辑');
});
test('remote addition refreshes a dirty folder without losing draft, focus or caret',async({page})=>{
  await createOwned(page);await page.locator('#docContent').fill('# 我正在写');await page.locator('#docContent').evaluate(el=>{el.focus();el.setSelectionRange(3,3);});
  await command(page,{type:'saveDocument',document:{id:'remote',taskId:'a',title:'代理新增文件',type:'notes',content:'# 新增'}});
  await expect(page.locator('#documentsView [data-open-doc="remote"]')).toBeVisible({timeout:10000});await expect(page.locator('#docContent')).toHaveValue('# 我正在写');await expect(page.locator('#docContent')).toBeFocused();
  expect(await page.locator('#docContent').evaluate(el=>el.selectionStart)).toBe(3);
});

test('search filters current folder without losing an edited draft',async({page})=>{
 await page.locator('[data-view="documents"]').click();await page.locator('#docContent').fill('草稿内容');
 const search=page.getByRole('searchbox',{name:'搜索当前文件夹文档'});await search.fill('不存在');
 await expect(page.getByText('没有匹配的文档')).toBeVisible();await expect(page.locator('#docContent')).toHaveValue('草稿内容');await expect(search).toBeFocused();
 await search.fill('执行计划');await expect(page.locator('[data-open-doc="global"]')).toBeVisible();
});
