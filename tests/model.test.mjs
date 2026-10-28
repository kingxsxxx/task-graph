import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, applyCommand, getReadiness, layoutGraph } from '../src/model.mjs';

const task = (id, status = 'backlog') => ({ id, title: id, description: '', owner: '', status, criteria: [{ id: `${id}-c`, text: '验证结果', result: status === 'done' ? 'passed' : 'pending', evidence: status === 'done' ? '测试通过' : '' }], documentIds: [], position: null });
const project = () => ({ id: 'p-test', name: '测试项目', description: '', revision: 1, tasks: [task('a'), task('b'), task('c')], edges: [{ from: 'a', to: 'b' }], documents: [], activity: [] });

test('rejects cycles, self dependencies, duplicate edges and missing endpoints', () => {
  for (const edge of [{ from: 'b', to: 'a' }, { from: 'a', to: 'a' }, { from: 'a', to: 'b' }, { from: 'missing', to: 'b' }]) {
    assert.throws(() => applyCommand(project(), { type: 'addEdge', ...edge }));
  }
});
test('completion requires acceptance evidence and completed prerequisites', () => {
  assert.throws(() => applyCommand(project(), { type: 'updateTask', id: 'b', patch: { status: 'active' } }));
  assert.throws(() => applyCommand(project(), { type: 'updateTask', id: 'a', patch: { status: 'done' } }));
  let p = applyCommand(project(), { type: 'updateTask', id: 'a', patch: { criteria: [{ id: 'a-c', text: '验证结果', result: 'passed', evidence: '日志：通过' }], status: 'done' } });
  p = applyCommand(p, { type: 'updateTask', id: 'b', patch: { status: 'active' } });
  assert.equal(p.tasks.find(t => t.id === 'b').status, 'active');
  assert.throws(() => applyCommand(p, { type: 'updateTask', id: 'a', patch: { status: 'backlog' } }));
});
test('empty acceptance and passed acceptance without evidence cannot complete a task', () => {
  for (const criteria of [[], [{ id: 'a-c', text: '标准', result: 'passed', evidence: '' }]]) {
    assert.throws(() => applyCommand(project(), { type: 'updateTask', id: 'a', patch: { status: 'done', criteria } }));
  }
});
test('readiness handles multiple prerequisites and respects manually blocked state', () => {
  const p = project(); p.edges.push({ from: 'c', to: 'b' }); p.tasks[0] = task('a', 'done');
  assert.deepEqual(getReadiness(p, 'b').blockers.map(t => t.id), ['c']);
  p.tasks[2] = task('c', 'done'); assert.equal(getReadiness(p, 'b').ready, true);
  p.tasks[1].status = 'blocked'; assert.equal(getReadiness(p, 'b').ready, false);
});
test('rejects unsafe IDs, invalid status, nonfinite coordinates and dangling document references', () => {
  for (const mutate of [p => p.id = '../escape', p => p.tasks[0].status = 'whatever', p => p.tasks[0].position = { x: Infinity, y: 2 }, p => p.tasks[0].documentIds = ['missing'], p => p.tasks[1].id = 'a']) {
    const p = project(); mutate(p); assert.throws(() => validateProject(p));
  }
});
test('deleting tasks and documents cleans references without mutating original input', () => {
  const p = project(); p.documents.push({ id: 'doc-1', title: '计划', type: 'plan', content: '# 内容' }); p.tasks[0].documentIds = ['doc-1'];
  const q = applyCommand(p, { type: 'deleteDocument', id: 'doc-1' });
  assert.deepEqual(q.tasks[0].documentIds, []); assert.equal(p.documents.length, 1);
  const r = applyCommand(q, { type: 'deleteTask', id: 'a' }); assert.deepEqual(r.edges, []);
});
test('layout follows topological order and works for disconnected and branched graphs', () => {
  const p = project(); p.edges.push({ from: 'a', to: 'c' });
  const layout = layoutGraph(p);
  assert.ok(layout.b.x > layout.a.x); assert.ok(layout.c.x > layout.a.x); assert.notEqual(layout.b.y, layout.c.y);
});
test('deterministic generated DAGs keep every edge directed forward in automatic layout', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const p = project(); p.tasks = Array.from({ length: 14 }, (_, i) => task(`n-${i}`)); p.edges = [];
    for (let i = 0; i < 14; i++) for (let j = i + 1; j < 14; j++) if ((i * 17 + j * 31 + seed * 13) % 7 === 0) p.edges.push({ from: `n-${i}`, to: `n-${j}` });
    validateProject(p); const layout = layoutGraph(p);
    for (const edge of p.edges) assert.ok(layout[edge.to].x > layout[edge.from].x);
  }
});
test('accepted snapshots remain small enough to reimport their full JSON backup', () => {
  const p = project();
  p.documents = Array.from({ length: 6 }, (_, i) => ({ id: `doc-${i}`, title: '大型中文文档', type: 'notes', content: '中'.repeat(500000) }));
  assert.throws(() => validateProject(p), /大小/);
});
