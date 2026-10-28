import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/http.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-graph-test-')); const store = new Store(dir); await store.init();
  t.after(() => rm(dir, { recursive: true, force: true })); return { dir, store };
}
test('accepted tasks and Markdown documents survive a new store instance', async t => {
  const { dir, store } = await setup(t); const p = await store.create({ name: '长程任务' });
  const q = await store.command(p.id, 1, { type: 'saveDocument', document: { id: 'doc-plan', title: '计划', type: 'plan', content: '# 中文计划\n\n- 一步一步完成' } });
  const restarted = new Store(dir); await restarted.init(); const restored = await restarted.get(p.id);
  assert.equal(restored.revision, 2); assert.equal(restored.documents[0].content, '# 中文计划\n\n- 一步一步完成');
  const head = (await readFile(join(dir, 'projects', p.id, 'HEAD'), 'utf8')).trim();
  assert.equal(await readFile(join(dir, 'projects', p.id, 'revisions', head, 'documents', 'doc-plan.md'), 'utf8'), q.documents[0].content);
});
test('simultaneous writes permit one winner and return explicit revision conflict', async t => {
  const { store } = await setup(t); const p = await store.create({ name: '并发' });
  const results = await Promise.allSettled(['甲', '乙'].map(title => store.command(p.id, 1, { type: 'createTask', task: { title } })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await store.get(p.id)).tasks.length, 1);
});
test('invalid commands and invalid imports do not alter committed snapshots', async t => {
  const { store, dir } = await setup(t); const p = await store.create({ name: '安全' });
  await assert.rejects(store.command(p.id, 1, { type: 'createTask', task: { id: '../../escape', title: '坏路径' } }));
  assert.equal((await store.get(p.id)).revision, 1);
  await assert.rejects(store.import({ ...p, tasks: [{ id: 'broken' }] }));
  assert.equal((await store.list()).length, 1); assert.deepEqual((await readdir(join(dir, 'projects'))), [p.id]);
});
test('import creates a separate project preserving graph and document content', async t => {
  const { store } = await setup(t); const p = await store.create({ name: '源项目' });
  const q = await store.command(p.id, 1, { type: 'saveDocument', document: { title: 'Roadmap', type: 'roadmap', content: 'v1 → v2' } });
  const imported = await store.import(q); assert.notEqual(imported.id, p.id); assert.equal(imported.documents[0].content, 'v1 → v2'); assert.equal(imported.revision, 1);
});
test('API enforces revisions, validates JSON, blocks cross-origin writes and serves assets', async t => {
  const { store } = await setup(t); const app = createApp(store); await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve))); const base = `http://127.0.0.1:${app.address().port}`;
  const post = (path, value, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: typeof value === 'string' ? value : JSON.stringify(value) });
  const response = await post('/api/projects', { name: 'API 项目' }); assert.equal(response.status, 201); const p = await response.json();
  assert.equal((await post(`/api/projects/${p.id}/commands`, { revision: 1, command: { type: 'createTask', task: { title: '阶段一' } } })).status, 200);
  assert.equal((await post(`/api/projects/${p.id}/commands`, { revision: 1, command: { type: 'renameProject', name: '覆盖' } })).status, 409);
  assert.equal((await post('/api/projects', '{bad')).status, 400);
  assert.equal((await post('/api/projects', { name: '外部写入' }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await fetch(base + '/')).status, 200);
  for (const [path, type] of [['/theme.js', 'text/javascript'], ['/refinement.css', 'text/css'], ['/documents.js', 'text/javascript']]) {
    const asset = await fetch(base + path); assert.equal(asset.status, 200); assert.ok(asset.headers.get('content-type').startsWith(type));
  }
  assert.equal((await fetch(base + '/api/projects/' + p.id + '/export')).status, 200);
  assert.equal((await fetch(base + '/src/store.mjs')).status, 404);
});
