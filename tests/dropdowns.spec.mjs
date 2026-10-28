import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
let server,directory,base;
test.beforeAll(async()=>{directory=await mkdtemp(join(tmpdir(),'graph-dropdowns-'));server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,TASK_GRAPH_DATA:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server timeout')),10000);server.stdout.on('data',d=>{const m=d.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',d=>process.stderr.write(d));});});
test.afterAll(async()=>{if(server?.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}if(directory)await rm(directory,{recursive:true,force:true});});
test.beforeEach(async({page})=>{await page.goto(base+'/?project=project-demo');await expect(page.locator('.task-node')).toHaveCount(8);});
const menu=page=>page.getByRole('listbox');
test('theme popup uses rounded themed options and choosing one persists',async({page})=>{
  await page.locator('#themeToggle').click();await expect(menu(page)).toBeVisible();expect(await menu(page).evaluate(e=>parseFloat(getComputedStyle(e).borderRadius))).toBeGreaterThanOrEqual(10);await expect(menu(page).getByRole('option',{name:'经典深色',exact:true})).toHaveAttribute('aria-selected','true');await menu(page).getByRole('option',{name:'薄荷浅色',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','mint');await expect(menu(page)).toHaveCount(0);await page.reload();await expect(page.locator('#themeToggle')).toHaveValue('mint');
});
test('keyboard navigation commits on Enter and Escape cancels without losing drafts',async({page})=>{
  await page.locator('[data-view="documents"]').click();await page.locator('#docContent').fill('# 保留草稿');const select=page.locator('#themeToggle');await select.focus();await page.keyboard.press('ArrowDown');await expect(menu(page)).toBeVisible();await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(select).toHaveValue('ocean');await expect(select).toBeFocused();await expect(page.locator('#docContent')).toHaveValue('# 保留草稿');await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Escape');await expect(select).toHaveValue('ocean');await expect(menu(page)).toHaveCount(0);
});
test('dynamic task, criterion, document and dialog selectors share the popup',async({page})=>{
  await page.locator('[data-task="build"]').click();for(const locator of [page.locator('#inspector [name="status"]'),page.getByLabel('第 1 项验收结果',{exact:true}),page.getByLabel('第 1 项验收文档',{exact:true})]){await locator.click();await expect(menu(page)).toBeVisible();await page.keyboard.press('Escape');}
  await page.locator('[data-view="documents"]').click();for(const id of ['documentCollection','documentScope','docType']){await page.locator('#'+id).click();await expect(menu(page)).toBeVisible();await page.keyboard.press('Escape');}
  await page.locator('[data-view="graph"]').click();await page.locator('#connectTasks').click();await page.locator('#modal [name="from"]').click();await expect(menu(page)).toBeVisible();await menu(page).getByRole('option').last().click();await expect(menu(page)).toHaveCount(0);await expect(page.locator('#modal [name="from"]')).toHaveValue('ship');await page.locator('#modalCancel').click();
});
test('popups fit mobile viewport in every palette and outside clicks dismiss',async({page})=>{
  await page.setViewportSize({width:390,height:844});for(const theme of ['dark','light','mint','ocean']){await page.locator('#themeToggle').selectOption(theme);await page.locator('#themeToggle').click();const box=await menu(page).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(844);await page.screenshot({path:`test-results/dropdown-${theme}-mobile.png`});await page.locator('#crumbName').click();await expect(menu(page)).toHaveCount(0);}
});
test('long option lists scroll and safely display literal titles',async({page})=>{
  await page.locator('[data-task="build"]').click();const select=page.getByLabel('第 1 项验收文档',{exact:true});await select.evaluate(e=>{for(let i=0;i<100;i++){const o=document.createElement('option');o.value='extra-'+i;o.textContent=i===99?'<img src=x onerror=alert(1)>':'验收记录 '+i;e.append(o);}});await select.click();await expect(menu(page).getByRole('option')).toHaveCount(101);expect(await menu(page).evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await expect(menu(page).locator('img')).toHaveCount(0);await page.keyboard.press('End');await expect(menu(page).getByRole('option').last()).toBeInViewport();await page.keyboard.press('Escape');
});
test('touch selection opens the same popup and applies the selected theme',async({browser})=>{
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});try{const page=await context.newPage();await page.goto(base+'/?project=project-demo');await expect(page.locator('.task-node')).toHaveCount(8);await page.locator('#themeToggle').tap();await expect(menu(page)).toBeVisible();await menu(page).getByRole('option',{name:'深海青绿',exact:true}).tap();await expect(page.locator('#themeToggle')).toHaveValue('ocean');await expect(menu(page)).toHaveCount(0);}finally{await context.close();}
});
test('bottom anchors flip upward, disabled choices cannot commit and removed anchors dismiss',async({page})=>{
  const select=page.locator('#themeToggle');await select.evaluate(e=>{e.style.position='fixed';e.style.bottom='8px';e.style.right='8px';e.options[3].disabled=true;});await select.click();const a=await select.boundingBox(),b=await menu(page).boundingBox();expect(b.y+b.height).toBeLessThan(a.y);await menu(page).getByRole('option',{name:'深海青绿',exact:true}).click({force:true});await expect(select).toHaveValue('dark');await expect(menu(page)).toBeVisible();await select.focus();await page.keyboard.press('Tab');await expect(menu(page)).toHaveCount(0);await select.click();await select.evaluate(e=>e.remove());await expect(menu(page)).toHaveCount(0);
});
test('attribute-only disabled or hidden changes dismiss a stale popup',async({page})=>{
  for(const mutation of ['disabled','hidden','display','inert']){await page.reload();await expect(page.locator('.task-node')).toHaveCount(8);const select=page.locator('#themeToggle');await select.click();await select.evaluate((e,kind)=>{if(kind==='disabled')e.disabled=true;else if(kind==='hidden')e.parentElement.hidden=true;else if(kind==='display')e.style.display='none';else e.parentElement.inert=true;},mutation);await expect(page.locator('.select-popup')).toHaveCount(0);}
  await page.reload();await page.locator('#connectTasks').click();await page.locator('#modal [name="from"]').click();await expect(menu(page)).toBeVisible();await page.locator('#modal').evaluate(e=>e.close());await expect(page.locator('.select-popup')).toHaveCount(0);
});
