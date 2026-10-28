import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/http.mjs';

const script = fileURLToPath(new URL('../skills/task-graph/scripts/task-graph.mjs', import.meta.url));
function cli(args, input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'task-graph-skill-'));
  const store = new Store(directory); await store.init();
  const app = createApp(store); await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  return { store, directory, run: (args, input = '') => cli(['--url', base, ...args], input) };
}
const value = result => { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); };

test('skill CLI exposes help without requiring a running service', async () => {
  const result = await cli(['--help']); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /command/);
});
test('skill CLI creates and reads a project without shell interpolation', async t => {
  const { run } = await setup(t);
  const p = value(await run(['create', '--name', '中文 $(not-a-command)', '--description', '已确认范围']));
  assert.equal(p.name, '中文 $(not-a-command)');
  assert.equal(value(await run(['list']))[0].id, p.id);
  assert.equal(value(await run(['get', p.id])).description, '已确认范围');
});
test('skill CLI persists node routes and separate acceptance documents through the actual API', async t => {
  const { run, store, directory } = await setup(t);
  let p = value(await run(['create', '--name', '隔离验证']));
  const send = async command => { p = value(await run(['command', p.id, '--revision', String(p.revision), '--file', '-'], JSON.stringify(command))); };
  await send({ type: 'createTask', task: { id: 'node-core', title: '核心实现', criteria: [{ id: 'check-core', text: '核心测试通过', result: 'pending', evidence: '' }] } });
  await send({ type: 'saveDocument', document: { id: 'route', taskId: 'node-core', title: '开发路线', type: 'technical', content: '# 路线\n保持细节' } });
  await send({ type: 'saveAcceptanceDocument', document: { id: 'accept', taskId: 'node-core', title: '验收记录', content: '# 验收\n命令与结果' }, criterionId: 'check-core' });
  assert.equal(p.documents[0].taskId, 'node-core');
  assert.equal(p.acceptanceDocuments[0].taskId, 'node-core');
  assert.equal(p.tasks[0].criteria[0].acceptanceDocumentId, 'accept');
  const file = join(directory, 'patch.json'); await writeFile(file, JSON.stringify({ type: 'updateTask', id: 'node-core', patch: { status: 'review' } }));
  p = value(await run(['command', p.id, '--revision', String(p.revision), '--file', file]));
  assert.equal(p.tasks[0].status, 'review');
  assert.equal(value(await run(['storage', p.id])).acceptanceDocuments[0].documentId, 'accept');
  const reopened = new Store(directory); await reopened.init(); assert.deepEqual(await reopened.get(p.id), await store.get(p.id));
});
test('skill CLI never rebases or retries a stale revision over a user edit', async t => {
  const { run, store } = await setup(t); const p = await store.create({ name: '原名称' });
  await store.command(p.id, 1, { type: 'renameProject', name: '用户修改' });
  const result = await run(['command', p.id, '--revision', '1', '--file', '-'], JSON.stringify({ type: 'renameProject', name: '代理修改' }));
  assert.equal(result.code, 3, result.stderr); assert.equal(JSON.parse(result.stderr).status, 409);
  assert.equal((await store.get(p.id)).name, '用户修改'); assert.equal((await store.get(p.id)).revision, 2);
});
test('skill CLI refuses unversioned, malformed and unknown writes before changing state', async t => {
  const { run, store } = await setup(t); const p = await store.create({ name: '验证输入' });
  for (const [args, input] of [
    [['command', p.id, '--file', '-'], '{"type":"renameProject","name":"不应保存"}'],
    [['command', p.id, '--revision', '1', '--file', '-'], '{bad'],
    [['command', p.id, '--revision', '1', '--file', '-'], '{"type":"invented"}'],
    [['command', '../escape', '--revision', '1', '--file', '-'], '{}'],
    [['get', p.id, '--unknown'], ''],
  ]) { const result = await run(args, input); assert.equal(result.code, 2, result.stderr); }
  assert.equal((await store.get(p.id)).revision, 1);
});
test('skill CLI requires a separate destructive-operation flag', async t => {
  const { run, store } = await setup(t); let p = await store.create({ name: '删除保护' });
  p = await store.command(p.id, p.revision, { type: 'createTask', task: { id: 'keep', title: '保留' } });
  const args = ['command', p.id, '--revision', String(p.revision), '--file', '-']; const input = '{"type":"deleteTask","id":"keep"}';
  assert.equal((await run(args, input)).code, 2); assert.equal((await store.get(p.id)).tasks.length, 1);
  assert.equal(value(await run([...args, '--confirm-destructive'], input)).tasks.length, 0);
});
test('skill CLI distinguishes ready work, active work, blocked work and pending review', async t => {
  const { run, store } = await setup(t); let p = await store.create({ name: '恢复' });
  const send = async command => p = await store.command(p.id, p.revision, command);
  for (const [id, status] of [['first', 'backlog'], ['next', 'backlog'], ['doing', 'active'], ['reviewing', 'review'], ['stuck', 'blocked']]) await send({ type: 'createTask', task: { id, title: id, status } });
  await send({ type: 'addEdge', from: 'first', to: 'next' });
  const ready = value(await run(['ready', p.id]));
  assert.deepEqual(ready.ready.map(t => t.id), ['first']);
  assert.deepEqual(ready.active.map(t => t.id), ['doing']);
  assert.deepEqual(ready.waitingForReview.map(t => t.id), ['reviewing']);
  assert.deepEqual(ready.blocked.map(t => t.id), ['stuck']); assert.equal(ready.revision, p.revision);
});
test('skill CLI surfaces server validation without claiming completion', async t => {
  const { run, store } = await setup(t); let p = await store.create({ name: '验收约束' });
  p = await store.command(p.id, p.revision, { type: 'createTask', task: { id: 'node', title: '未验收' } });
  const result = await run(['command', p.id, '--revision', String(p.revision), '--file', '-'], '{"type":"updateTask","id":"node","patch":{"status":"done"}}');
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stderr).status, 400);
  assert.equal((await store.get(p.id)).tasks[0].status, 'backlog');
});
test('skill CLI rejects non-loopback, credential-bearing and path-bearing endpoints', async () => {
  for (const url of ['http://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost:4310', 'http://localhost:4310/extra', 'file:///tmp/data', 'http://localhost:4310/?q=secret']) {
    const result = await cli(['--url', url, 'list']); assert.equal(result.code, 2, result.stderr);
  }
});
test('skill CLI does not retry an uncertain write after the connection is lost', async t => {
  let writes = 0;
  const server = createServer((req) => { writes++; req.resume(); req.on('end', () => req.socket.destroy()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await cli(['--url', `http://127.0.0.1:${server.address().port}`, 'create', '--name', '不确定提交']);
  assert.equal(result.code, 4, result.stderr); assert.equal(JSON.parse(result.stderr).outcome, 'unknown'); assert.equal(writes, 1);
});
