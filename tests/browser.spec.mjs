import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server, directory, base;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'task-graph-browser-'));
  server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, TASK_GRAPH_DATA: directory, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser test server startup timed out')), 10000);
    server.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    server.stderr.on('data', data => process.stderr.write(data));
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
});
test.afterAll(async () => {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function ready(page, focus = true) { await page.goto(base); await expect(page.locator('.task-node')).toHaveCount(8); await page.evaluate(() => document.fonts.ready); if (focus) await page.locator('[data-task="build"]').click(); }
async function update(page, patch) {
  return page.evaluate(async ({ patch }) => {
    const p = await (await fetch('/api/projects/project-demo')).json();
    const r = await fetch('/api/projects/project-demo/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: p.revision, command: { type: 'updateTask', id: 'build', patch } }) });
    if (!r.ok) throw new Error(await r.text()); return r.json();
  }, { patch });
}
test('desktop and mobile display the task graph without horizontal page overflow', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await ready(page, false);
  await page.screenshot({ path: 'test-results/preview-overview.png', fullPage: true });
  await page.locator('[data-task="build"]').click();
  await expect(page.locator('#inspector')).toBeVisible();
  await page.screenshot({ path: 'test-results/preview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="close"]').click();
  await expect.poll(async () => { const box = await page.locator('#sidebar').boundingBox(); return Math.round(box.x + box.width); }).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/preview-mobile.png', fullPage: true });
  await page.locator('#menuToggle').click(); await page.getByRole('button', { name: '项目文档', exact: false }).first().click();
  await expect(page.locator('#docContent')).toBeVisible(); expect(errors).toEqual([]);
});
test('graph supports search, status filtering, zoom and persistent node dragging', async ({ page }) => {
  await ready(page, false); const initialZoom = await page.locator('#zoomValue').textContent();
  await page.locator('#zoomIn').click(); expect(await page.locator('#zoomValue').textContent()).not.toBe(initialZoom);
  await page.locator('#fitGraph').click();
  await page.locator('#search').fill('实现核心'); await expect(page.locator('.task-node:visible')).toHaveCount(1);
  await page.locator('#search').fill(''); await page.locator('#statusFilter').selectOption('done'); await expect(page.locator('.task-node:visible')).toHaveCount(2);
  await page.locator('#statusFilter').selectOption('all'); await page.locator('[data-task="build"]').click();
  const before = (await (await page.request.get(base + '/api/projects/project-demo')).json()).tasks.find(t => t.id === 'build').position;
  const box = await page.locator('[data-task="build"]').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 85, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('#syncState')).toContainText('已同步');
  const after = (await (await page.request.get(base + '/api/projects/project-demo')).json()).tasks.find(t => t.id === 'build').position;
  expect(after.x).toBeGreaterThan(before.x); expect(after.y).toBeGreaterThan(before.y);
});
test('a stale write conflicts without losing the draft and shared-field overwrite requires confirmation', async ({ page }) => {
  await ready(page); await page.locator('#inspector [name="title"]').fill('需要保留的草稿');
  await update(page, { title: '代理同时修改的标题' });
  await page.locator('[data-action="save"]').click(); await expect(page.locator('#toast')).toContainText('项目已被其他窗口或代理更新');
  await expect(page.locator('#inspector [name="title"]')).toHaveValue('需要保留的草稿');
  await page.locator('#syncState').click();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('都修改了'); dialog.dismiss(); });
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('#inspector [name="title"]')).toHaveValue('需要保留的草稿');
  const p = await (await page.request.get(base + '/api/projects/project-demo')).json(); expect(p.tasks.find(t => t.id === 'build').title).toBe('代理同时修改的标题');
});
test('reselecting a stage or open document preserves unsaved edits', async ({ page }) => {
  await ready(page); await page.locator('#inspector [name="title"]').fill('尚未保存的阶段编辑');
  await page.locator('[data-task="build"]').click();
  await expect(page.locator('#inspector [name="title"]')).toHaveValue('尚未保存的阶段编辑');
  page.on('dialog', d => d.accept()); await page.locator('[data-view="documents"]').click();
  await page.locator('#docContent').fill('# 尚未保存的文档');
  await page.locator('#documentsView [data-open-doc="doc-plan"]').click(); await expect(page.locator('#docContent')).toHaveValue('# 尚未保存的文档');
  await page.locator('[data-view="documents"]').click(); await expect(page.locator('#docContent')).toHaveValue('# 尚未保存的文档');
});
test('clean manual refresh adopts agent edits instead of advancing revision with stale draft', async ({ page }) => {
  await ready(page); await update(page, { title: '代理更新后的核心阶段' });
  await page.locator('#syncState').click();
  await expect(page.locator('#inspector [name="title"]')).toHaveValue('代理更新后的核心阶段');
  await page.locator('[data-action="save"]').click();
  const p = await page.request.get(base + '/api/projects/project-demo'); expect((await p.json()).tasks.find(t => t.id === 'build').title).toBe('代理更新后的核心阶段');
});
test('saving locks editing and navigation until the submitted snapshot is acknowledged', async ({ page }) => {
  await ready(page); await page.locator('#inspector [name="title"]').fill('保存中的编辑');
  let finish; const barrier = new Promise(resolve => finish = resolve); let entered;
  const started = new Promise(resolve => entered = resolve);
  await page.route('**/commands', async route => { entered(); await barrier; await route.continue(); });
  await page.locator('[data-action="save"]').click(); await started;
  expect(await page.locator('.app-shell').evaluate(element => element.inert)).toBe(true);
  finish(); await expect(page.locator('#syncState')).toContainText('已同步');
  await expect(page.locator('#inspector [name="title"]')).toHaveValue('保存中的编辑');
  expect(await page.locator('.app-shell').evaluate(element => element.inert)).toBe(false);
});
test('dirty refresh preserves local changed fields while adopting unrelated agent updates', async ({ page }) => {
  await ready(page); await page.locator('#inspector [name="title"]').fill('我的未保存标题');
  await update(page, { owner: '代理的新负责人' }); await page.locator('#syncState').click();
  await expect(page.locator('#inspector [name="title"]')).toHaveValue('我的未保存标题');
  await expect(page.locator('#inspector [name="owner"]')).toHaveValue('代理的新负责人');
  await page.locator('[data-action="save"]').click(); await expect(page.locator('#toast')).toHaveText('阶段与验收记录已保存');
  const p = await (await page.request.get(base + '/api/projects/project-demo')).json();
  expect(p.tasks.find(t => t.id === 'build').owner).toBe('代理的新负责人');
});
test('creates stages, connects dependencies, enforces acceptance, saves documents and roundtrips export', async ({ page }) => {
  await ready(page); await page.locator('#newProject').click();
  await page.locator('#modal [name="name"]').fill('浏览器验证项目'); await page.locator('#modal button[type="submit"]').click();
  await expect(page.locator('#crumbName')).toHaveText('浏览器验证项目');
  async function addTask(title) {
    await page.locator('#newTask').click(); await page.locator('#modal [name="title"]').fill(title); await page.locator('#modal [name="criterion"]').fill('完整流程通过'); await page.locator('#modal button[type="submit"]').click(); await expect(page.locator('#inspector [name="title"]')).toHaveValue(title);
  }
  await addTask('第一阶段');
  await page.locator('#inspector [name="status"]').selectOption('done'); await page.locator('[data-action="save"]').click(); await expect(page.locator('#toast')).toContainText('验收项必须通过');
  await page.locator('[data-criterion-field="result"]').selectOption('passed'); await page.locator('[data-criterion-field="evidence"]').fill('真实浏览器验证：完整流程通过');
  await page.locator('[data-action="save"]').click(); await expect(page.locator('#toast')).toHaveText('阶段与验收记录已保存');
  await addTask('第二阶段'); await page.locator('#connectTasks').click(); await page.locator('#modal button[type="submit"]').click(); await expect(page.locator('#edgeCount')).toHaveText('1 条依赖');
  await page.locator('#inspector [name="status"]').selectOption('active'); await page.locator('[data-action="save"]').click(); await expect(page.locator('#toast')).toHaveText('阶段与验收记录已保存');
  await page.locator('#newDocSide').click(); await page.locator('#modal [name="title"]').fill('真实 Roadmap'); await page.locator('#modal [name="type"]').selectOption('roadmap'); await page.locator('#modal button[type="submit"]').click();
  await page.locator('#docContent').fill('# Roadmap\n\n- 第一阶段\n- 第二阶段\n\n<img src=x onerror=alert(1)>'); await page.locator('[data-doc-action="save"]').click();
  await expect(page.locator('#toast')).toHaveText('文档已保存为 Markdown'); expect(await page.locator('#docPreview img').count()).toBe(0);
  await page.reload(); await page.locator('[data-view="documents"]').click(); await expect(page.locator('#docContent')).toContainText('第二阶段');
  const download = page.waitForEvent('download'); await page.locator('#exportProject').click(); const file = await download; const path = await file.path();
  await page.locator('#importFile').setInputFiles(path); await expect(page.locator('#toast')).toContainText('已作为新项目导入');
  const projects = await (await page.request.get(base + '/api/projects')).json(); expect(projects.filter(p => p.name === '浏览器验证项目')).toHaveLength(2);
});
