import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server, directory, base, secondId;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'task-graph-refinement-'));
  server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, TASK_GRAPH_DATA: directory, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
    server.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    server.stderr.on('data', data => process.stderr.write(data));
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  const p = await (await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '视频教程探索' }) })).json(); secondId = p.id;
  const response = await fetch(`${base}/api/projects/${p.id}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: p.revision, command: { type: 'createTask', task: { title: '确认首个用户场景' } } }) });
  expect(response.ok).toBe(true);
});
test.afterAll(async () => {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function openDemo(page) { await page.goto(base + '/?project=project-demo'); await page.waitForSelector('.project-item'); if ((await page.locator('#crumbName').textContent()) !== '构建下一站') await page.locator('[data-project="project-demo"]').click(); await expect(page.locator('#crumbName')).toHaveText('构建下一站'); await page.evaluate(() => document.fonts.ready); }

test('stage creation belongs to the graph toolbar alongside connect and arrange',async({page})=>{
  await openDemo(page);await expect(page.locator('.hero #newTask')).toHaveCount(0);await expect(page.locator('.graph-toolbar #newTask')).toHaveCount(1);
  for(const width of [1680,800,390]){await page.setViewportSize({width,height:1000});for(const theme of ['dark','light','mint','ocean']){await page.locator('#themeToggle').selectOption(theme);const boxes=await Promise.all(['newTask','connectTasks','autoLayout'].map(id=>page.locator(`#${id}`).boundingBox()));expect(boxes.every(b=>Math.abs(b.y-boxes[0].y)<1&&Math.abs(b.height-boxes[0].height)<1)).toBe(true);expect(boxes[0].x+boxes[0].width).toBeLessThanOrEqual(boxes[1].x);expect(boxes[1].x+boxes[1].width).toBeLessThanOrEqual(boxes[2].x);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}}
  await page.getByRole('button',{name:'新建阶段',exact:true}).click();await expect(page.locator('#modal [name="title"]')).toBeVisible();await page.locator('#modalCancel').click();await page.screenshot({path:'test-results/graph-toolbar-mobile.png',fullPage:true});
});

test('four palettes apply across workspace surfaces and persist after reload',async({page})=>{
  await openDemo(page);const picker=page.getByRole('combobox',{name:'选择配色主题',exact:true});await expect(picker.locator('option')).toHaveCount(4);
  for(const [theme,bg,panel,primary] of [['mint','rgb(255, 255, 255)','rgb(227, 246, 245)','rgb(39, 35, 67)'],['ocean','rgb(13, 31, 45)','rgb(29, 46, 61)','rgb(13, 110, 110)']]){
    await picker.selectOption(theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);expect(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(bg);expect(await page.locator('.graph-panel').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(panel);await expect.poll(()=>page.locator('#newTask').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(primary);
    await page.reload();await expect(picker).toHaveValue(theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await page.locator('[data-task="build"]').click();await page.screenshot({path:`test-results/palette-${theme}-graph.png`,fullPage:true});await page.locator('[data-view="documents"]').click();expect(await page.locator('.doc-editor-panel').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(panel);await page.screenshot({path:`test-results/palette-${theme}-documents.png`,fullPage:true});
  }
});
test('palette switching preserves stage and document drafts without mobile overflow',async({page})=>{
  await openDemo(page);await page.locator('[data-task="build"]').click();await page.locator('#inspector [name="title"]').fill('未保存阶段');for(const theme of ['mint','ocean','light','dark']){await page.locator('#themeToggle').selectOption(theme);await expect(page.locator('#inspector [name="title"]')).toHaveValue('未保存阶段');}
  page.once('dialog',d=>d.accept());await page.locator('[data-view="documents"]').click();await page.locator('#docContent').fill('# 未保存主题草稿');await page.setViewportSize({width:390,height:844});for(const theme of ['mint','ocean','light','dark']){await page.locator('#themeToggle').selectOption(theme);await expect(page.locator('#docContent')).toHaveValue('# 未保存主题草稿');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/palette-${theme}-mobile.png`,fullPage:true});}
});
test('unrecognized saved palette safely falls back to the original dark theme',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('task-graph-theme','unknown'));await openDemo(page);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('#themeToggle')).toHaveValue('dark');
});
test('minimap nodes remain distinguishable against both new palette backgrounds',async({page})=>{
  await openDemo(page);await page.locator('[data-task="build"]').click();for(const theme of ['mint','ocean']){await page.locator('#themeToggle').selectOption(theme);const contrasts=await page.locator('#minimap').evaluate(el=>{const l=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(x=>Number(x)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};const bg=l(getComputedStyle(el).backgroundColor);return [...el.querySelectorAll('rect')].map(r=>{const fg=l(getComputedStyle(r).fill);return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);});});expect(contrasts.length).toBeGreaterThan(0);expect(contrasts.every(c=>c>=3)).toBe(true);}
});

test('project heading expands the list and selecting another project clears filters and opens its graph', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: '我的项目', exact: true }).click(); await expect(page.locator('#projectList')).toBeHidden();
  await page.getByRole('button', { name: '我的项目', exact: true }).click(); await expect(page.locator('#projectList')).toBeVisible();
  await page.locator('#search').fill('不会匹配的搜索'); await page.locator('#statusFilter').selectOption('done');
  await page.locator('[data-view="documents"]').click();
  await page.locator(`[data-project="${secondId}"]`).click();
  await expect(page.locator('#crumbName')).toHaveText('视频教程探索'); await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('.task-node:visible')).toHaveCount(1); await expect(page.locator('#search')).toHaveValue(''); await expect(page.locator('#statusFilter')).toHaveValue('all');
  await expect(page).toHaveURL(new RegExp(secondId));
  await page.reload(); await expect(page.locator('#crumbName')).toHaveText('视频教程探索');
});
test('unchanged polling keeps project buttons connected and usable', async ({ page }) => {
  await openDemo(page); const button = await page.locator(`[data-project="${secondId}"]`).elementHandle();
  await page.waitForResponse(response => response.url() === base + '/api/projects' && response.request().method() === 'GET');
  await expect.poll(() => button.evaluate(element => element.isConnected)).toBe(true);
  await button.click(); await expect(page.locator('#crumbName')).toHaveText('视频教程探索');
});
test('compact statistics use less than 64px and the light theme persists across reload', async ({ page }) => {
  await openDemo(page);
  expect((await page.locator('#stats').boundingBox()).height).toBeLessThan(64);
  await page.locator('#themeToggle').selectOption('light'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(245, 247, 248)');
  await page.locator('[data-task="build"]').click(); await page.screenshot({ path: 'test-results/refinement-light.png', fullPage: true });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#themeToggle').selectOption('dark'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/refinement-dark.png', fullPage: true });
});
test('project switching works from the mobile navigation in the light theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openDemo(page);
  await page.locator('#themeToggle').selectOption('light');
  await page.locator('#menuToggle').click(); await page.locator(`[data-project="${secondId}"]`).click();
  await expect(page.locator('#crumbName')).toHaveText('视频教程探索');
  await expect.poll(async () => { const box = await page.locator('#sidebar').boundingBox(); return Math.round(box.x + box.width); }).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/refinement-mobile-light.png', fullPage: true });
});
test('desktop sidebar hides to expand the workspace and persists across reload',async({page})=>{
  await openDemo(page);const main=page.locator('.main-shell'),toggle=page.locator('#menuToggle');
  await expect(toggle).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','true');const before=await main.boundingBox();
  await toggle.click();await expect(page.locator('#sidebar')).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect((await main.boundingBox()).x).toBe(0);expect((await main.boundingBox()).width).toBeGreaterThan(before.width);
  await page.screenshot({path:'test-results/preview-sidebar-hidden.png',fullPage:true,animations:'disabled'});
  await page.reload();await expect(page.locator('#sidebar')).toBeHidden();await expect(toggle).toBeVisible();await toggle.click();await expect(page.locator('#sidebar')).toBeVisible();
  await page.reload();await expect(page.locator('#sidebar')).toBeVisible();
});
test('sidebar toggle preserves dirty document edits and mobile navigation ignores desktop preference',async({page})=>{
  await openDemo(page);await page.locator('[data-view="documents"]').click();await page.locator('#docContent').fill('# 未保存的侧栏测试');
  await page.locator('#menuToggle').click();await expect(page.locator('#sidebar')).toBeHidden();await expect(page.locator('#docContent')).toHaveValue('# 未保存的侧栏测试');await expect(page.locator('#syncState')).toContainText('未保存');
  await page.locator('#themeToggle').selectOption('light');await page.setViewportSize({width:390,height:844});await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','false');
  await page.locator('#menuToggle').click();await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','true');await expect(page.locator('#sidebar')).not.toHaveAttribute('inert','');
  await page.locator('[data-view="documents"]').click();await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','false');await expect(page.locator('#docContent')).toHaveValue('# 未保存的侧栏测试');
  await page.setViewportSize({width:1680,height:1050});await expect(page.locator('#sidebar')).toBeHidden();await page.locator('#menuToggle').click();await expect(page.locator('#sidebar')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Chinese system fonts and status legend remain readable in both palettes and enlarged graph',async({page})=>{
  await openDemo(page);
  for(const theme of ['dark','light','mint','ocean']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#themeToggle').selectOption(theme);
    const result=await page.locator('.legend').evaluate(el=>{
      const bg=getComputedStyle(el.closest('.graph-footer')).backgroundColor;
      const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(x=>Number(x)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
      return [...el.querySelectorAll('span')].map(s=>{const a=luminance(getComputedStyle(s).color),b=luminance(bg);return{size:parseFloat(getComputedStyle(s).fontSize),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),dot:parseFloat(getComputedStyle(s.querySelector('i')).width)};});
    });
    expect(result.every(s=>s.size>=11&&s.dot>=7&&s.contrast>=4.5)).toBe(true);
  }
  expect(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Microsoft YaHei');
  await page.locator('[data-task="build"]').click();await page.locator('#zoomIn').click();await page.locator('#zoomIn').click();await page.screenshot({path:'test-results/readable-chinese-light.png',fullPage:true});
});
