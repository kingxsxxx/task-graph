import { randomUUID } from 'node:crypto';

export const STATUSES = ['backlog', 'active', 'review', 'done', 'blocked'];
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const makeId = prefix => `${prefix}-${randomUUID()}`;
const fail = message => { throw new AppError(message); };
const record = (v, label) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${label}必须是对象`); };
export function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) fail('ID 格式不合法');
  return value;
}
function string(v, label, limit = 1000, required = false) {
  if (typeof v !== 'string' || v.length > limit || (required && !v.trim())) fail(`${label}为空或长度不合法`);
  return v;
}
function list(v, label, max = 500) { if (!Array.isArray(v) || v.length > max) fail(`${label}格式或数量不合法`); return v; }
function unique(items, label) {
  const ids = new Set();
  for (const item of items) { safeId(item.id); if (ids.has(item.id)) fail(`${label} ID 重复`); ids.add(item.id); }
  return ids;
}

export function validateProject(project) {
  record(project, '项目'); safeId(project.id); string(project.name, '项目名称', 120, true); string(project.description ?? '', '项目描述', 5000);
  if (!Number.isSafeInteger(project.revision) || project.revision < 1) fail('项目版本不合法');
  const tasks = list(project.tasks, '任务', 250), edges = list(project.edges, '依赖', 2000), docs = list(project.documents, '文档', 1000);
  const ids = unique(tasks, '任务'), docIds = unique(docs, '文档');
  const acceptance = list(project.acceptanceDocuments ?? [], '验收文档', 1000), acceptanceIds = unique(acceptance, '验收文档');
  if (docs.length + acceptance.length > 1000) fail('普通文档与验收文档合计超过 1000 份');
  for (const doc of acceptance) {
    if (docIds.has(doc.id)) fail('普通文档与验收文档 ID 冲突');
    safeId(doc.taskId); string(doc.title, '验收文档标题', 160, true); string(doc.content, '验收文档内容', 500000);
    if (typeof doc.archived !== 'boolean') fail('验收归档状态不合法');
    if (!doc.archived && !ids.has(doc.taskId)) fail('验收文档所属节点不存在');
    if (doc.archived) string(doc.archivedTaskTitle, '归档节点名称', 160, true);
  }
  for (const doc of docs) {
    string(doc.title, '文档标题', 160, true); string(doc.content, '文档内容', 500000);
    if (!['general', 'plan', 'roadmap', 'notes', 'technical', 'verification'].includes(doc.type)) fail('文档类型不合法');
    if (doc.taskId !== null && doc.taskId !== undefined) { safeId(doc.taskId); if (!ids.has(doc.taskId)) fail('文档所属节点不存在'); }
  }
  for (const task of tasks) {
    if (task.instanceId !== undefined) safeId(task.instanceId);
    string(task.title, '任务标题', 160, true); string(task.description ?? '', '任务描述', 10000); string(task.owner ?? '', '负责人', 120);
    if (!STATUSES.includes(task.status)) fail('任务状态不合法');
    const criteria = list(task.criteria, '验收项', 100); unique(criteria, '验收项');
    for (const criterion of criteria) {
      string(criterion.text, '验收标准', 2000, true); string(criterion.evidence, '验收证据', 10000);
      if (!['pending', 'passed', 'failed'].includes(criterion.result)) fail('验收结果不合法');
      if (criterion.documentId !== null && criterion.documentId !== undefined && criterion.documentId !== '') {
        if (typeof criterion.documentId !== 'string' || !docIds.has(criterion.documentId)) fail('验收文档不存在或 ID 不合法');
      }
      if (criterion.acceptanceDocumentId !== null && criterion.acceptanceDocumentId !== undefined && criterion.acceptanceDocumentId !== '') {
        const doc = acceptance.find(d=>d.id===criterion.acceptanceDocumentId);
        if (!acceptanceIds.has(criterion.acceptanceDocumentId) || !doc || doc.archived || doc.taskId !== task.id) fail('只能关联本节点的未归档验收文档');
        if (criterion.documentId) fail('不能同时关联旧普通文档与独立验收文档');
      }
    }
    list(task.documentIds, '文档关联', 100);
    if (new Set(task.documentIds).size !== task.documentIds.length) fail('文档关联重复');
    for (const id of task.documentIds) if (!docIds.has(id)) fail('关联文档不存在');
    if (task.position !== null && task.position !== undefined) {
      record(task.position, '节点位置');
      for (const axis of ['x', 'y']) if (!Number.isFinite(task.position[axis]) || Math.abs(task.position[axis]) > 100000) fail('节点坐标不合法');
    }
  }
  const pairs = new Set(), successors = new Map(tasks.map(t => [t.id, []])), incoming = new Map(tasks.map(t => [t.id, 0]));
  for (const edge of edges) {
    record(edge, '依赖'); if (!ids.has(edge.from) || !ids.has(edge.to)) fail('依赖端点不存在');
    if (edge.from === edge.to) fail('不能依赖自身');
    const key = `${edge.from}:${edge.to}`; if (pairs.has(key)) fail('依赖已经存在'); pairs.add(key);
    successors.get(edge.from).push(edge.to); incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const queue = tasks.filter(t => incoming.get(t.id) === 0).map(t => t.id); let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    visited++;
    for (const id of successors.get(queue[i])) { incoming.set(id, incoming.get(id) - 1); if (!incoming.get(id)) queue.push(id); }
  }
  if (visited !== tasks.length) fail('这条依赖会形成环，请保留单向推进关系');
  for (const task of tasks) {
    const blockers = getReadiness(project, task.id).blockers;
    if (['active', 'review', 'done'].includes(task.status) && blockers.length) fail(`「${task.title}」的前置任务尚未完成：${blockers.map(t => t.title).join('、')}`);
    if (task.status === 'done' && (!task.criteria.length || task.criteria.some(c => c.result !== 'passed' || !c.evidence.trim()))) fail(`「${task.title}」完成前，所有验收项必须通过并填写证据`);
  }
  if (project.activity !== undefined) {
    list(project.activity, '活动记录', 200);
    for (const entry of project.activity) { record(entry, '活动记录'); string(entry.text, '活动内容', 500); string(entry.at, '活动时间', 80); }
  }
  if (Buffer.byteLength(JSON.stringify(project, null, 2), 'utf8') > 7 * 1024 * 1024) fail('项目大小超过 7 MB，请拆分项目或缩减文档，保证导出的备份能够重新导入');
  return project;
}

export function getReadiness(project, id) {
  const task = project.tasks.find(t => t.id === id);
  if (!task) fail('任务不存在');
  const predecessors = project.edges.filter(e => e.to === id).map(e => project.tasks.find(t => t.id === e.from)).filter(Boolean);
  const blockers = predecessors.filter(t => t.status !== 'done');
  return { ready: task.status !== 'done' && task.status !== 'blocked' && !blockers.length, blockers, predecessors };
}

export function layoutGraph(project) {
  const levels = new Map(project.tasks.map(t => [t.id, 0]));
  const indegrees = new Map(project.tasks.map(t => [t.id, 0]));
  const next = new Map(project.tasks.map(t => [t.id, []]));
  for (const e of project.edges) { indegrees.set(e.to, indegrees.get(e.to) + 1); next.get(e.from).push(e.to); }
  const queue = project.tasks.filter(t => !indegrees.get(t.id)).map(t => t.id);
  for (let i = 0; i < queue.length; i++) for (const id of next.get(queue[i])) {
    levels.set(id, Math.max(levels.get(id), levels.get(queue[i]) + 1));
    indegrees.set(id, indegrees.get(id) - 1); if (!indegrees.get(id)) queue.push(id);
  }
  const groups = new Map();
  for (const task of project.tasks) { const level = levels.get(task.id); if (!groups.has(level)) groups.set(level, []); groups.get(level).push(task.id); }
  const result = {};
  for (const [level, ids] of groups) ids.forEach((id, index) => { result[id] = { x: 100 + level * 325, y: 240 + (index - (ids.length - 1) / 2) * 190 }; });
  return result;
}

export function applyCommand(original, command) {
  record(command, '操作');
  const project = structuredClone(original), now = new Date().toISOString();
  const find = id => { const task = project.tasks.find(t => t.id === id); if (!task) fail('任务不存在'); return task; };
  const checkLegacy = (criteria, previous = []) => {
    for (const c of criteria) if (c.documentId && previous.find(old=>old.id===c.id)?.documentId !== c.documentId) fail('不能新增或更换旧普通验收引用，请使用节点独立验收文档');
  };
  let text;
  switch (command.type) {
    case 'createTask': {
      const value = command.task ?? {}; record(value, '任务');
      const task = { id: value.id ?? makeId('task'), instanceId: makeId('instance'), title: value.title ?? '新阶段', description: value.description ?? '', owner: value.owner ?? '', status: value.status ?? 'backlog', criteria: value.criteria ?? [], documentIds: value.documentIds ?? [], position: value.position ?? null, updatedAt: now };
      checkLegacy(list(task.criteria, '验收项', 100));
      project.tasks.push(task); text = `创建阶段 · ${task.title}`; break;
    }
    case 'updateTask': {
      const task = find(command.id); record(command.patch, '任务更新');
      const allowed = ['title', 'description', 'owner', 'status', 'criteria', 'documentIds', 'position'];
      for (const key of Object.keys(command.patch)) if (!allowed.includes(key)) fail(`不允许更新字段：${key}`);
      if (command.patch.criteria !== undefined) checkLegacy(list(command.patch.criteria,'验收项',100),task.criteria);
      Object.assign(task, command.patch, { updatedAt: now }); text = `更新阶段 · ${task.title}`; break;
    }
    case 'deleteTask': {
      text = `删除阶段 · ${find(command.id).title}`;
      for (const doc of project.acceptanceDocuments ?? []) if (doc.taskId === command.id && !doc.archived) { doc.archived = true; doc.archivedTaskTitle = find(command.id).title; }
      for (const doc of project.documents) if (doc.taskId === command.id) doc.taskId = null;
      project.tasks = project.tasks.filter(t => t.id !== command.id); project.edges = project.edges.filter(e => e.from !== command.id && e.to !== command.id); break;
    }
    case 'addEdge': project.edges.push({ from: command.from, to: command.to }); text = `建立依赖 · ${find(command.from).title} → ${find(command.to).title}`; break;
    case 'removeEdge': {
      if (!project.edges.some(e => e.from === command.from && e.to === command.to)) fail('依赖不存在');
      project.edges = project.edges.filter(e => e.from !== command.from || e.to !== command.to); text = '移除任务依赖'; break;
    }
    case 'saveDocument': {
      record(command.document, '文档'); const value = command.document;
      const old = project.documents.find(d => d.id === value.id);
      if (old && Object.hasOwn(value, 'taskId') && (value.taskId ?? null) !== (old.taskId ?? null)) fail('保存内容时不能修改文档归属');
      const doc = { id: value.id ?? makeId('doc'), title: value.title ?? '未命名文档', type: value.type ?? 'notes', content: value.content ?? '', taskId: old ? old.taskId ?? null : value.taskId ?? null, updatedAt: now };
      const index = project.documents.findIndex(d => d.id === doc.id);
      if (index === -1) project.documents.push(doc); else project.documents[index] = doc;
      text = `保存文档 · ${doc.title}`; break;
    }
    case 'deleteDocument': {
      if (!project.documents.some(d => d.id === command.id)) fail('文档不存在');
      project.documents = project.documents.filter(d => d.id !== command.id);
      for (const task of project.tasks) {
        task.documentIds = task.documentIds.filter(id => id !== command.id);
        for (const criterion of task.criteria) if (criterion.documentId === command.id) criterion.documentId = null;
      }
      text = '删除文档'; break;
    }
    case 'saveAcceptanceDocument': {
      record(command.document,'验收文档'); const value=command.document;
      const collection=project.acceptanceDocuments ??= [], old=collection.find(d=>d.id===value.id);
      if (old?.archived) fail('归档验收文档只读，不能修改');
      if (old && Object.hasOwn(value,'taskId') && value.taskId !== old.taskId) fail('不能改变验收文档所属节点');
      if (Object.hasOwn(value,'archived') && value.archived !== (old?.archived ?? false)) fail('不能改变验收归档状态');
      if (old && command.criterionId !== undefined) fail('直接关联仅用于新建验收文档');
      const owner=find(old?.taskId ?? value.taskId);
      const doc={id:value.id ?? makeId('acceptance'),taskId:owner.id,title:value.title ?? '验收记录',content:value.content ?? '',archived:false,updatedAt:now};
      if (command.criterionId !== undefined) {
        const c=owner.criteria.find(c=>c.id===command.criterionId); if(!c) fail('验收项不存在');
        c.acceptanceDocumentId=doc.id; c.documentId=null; owner.updatedAt=now;
      }
      if(old) collection[collection.indexOf(old)]=doc; else collection.push(doc);
      text=`保存验收文档 · ${doc.title}`; break;
    }
    case 'deleteAcceptanceDocument': {
      const collection=project.acceptanceDocuments ?? [], doc=collection.find(d=>d.id===command.id);
      if(!doc) fail('验收文档不存在');
      project.acceptanceDocuments=collection.filter(d=>d.id!==command.id);
      for(const task of project.tasks) for(const c of task.criteria) if(c.acceptanceDocumentId===command.id) c.acceptanceDocumentId=null;
      text=`删除验收文档 · ${doc.title}`; break;
    }
    case 'convertAcceptanceDocument': {
      const task=find(command.taskId), c=task.criteria.find(c=>c.id===command.criterionId);
      if(!c || !c.documentId || c.documentId!==command.documentId) fail('旧验收关联已改变，请刷新后重试');
      const source=project.documents.find(d=>d.id===command.documentId); if(!source) fail('原普通文档不存在');
      const doc={id:makeId('acceptance'),taskId:task.id,title:command.title ?? source.title,content:source.content,archived:false,updatedAt:now};
      (project.acceptanceDocuments ??= []).push(doc); c.documentId=null; c.acceptanceDocumentId=doc.id; task.updatedAt=now;
      text=`复制为独立验收文档 · ${doc.title}`; break;
    }
    case 'renameProject': project.name = command.name; project.description = command.description ?? project.description; text = '更新项目资料'; break;
    case 'autoLayout': {
      const positions = layoutGraph(project); for (const task of project.tasks) task.position = positions[task.id]; text = '整理任务图布局'; break;
    }
    default: fail('未知操作');
  }
  project.updatedAt = now;
  project.activity = [{ text: text.slice(0, 500), at: now }, ...(project.activity ?? [])].slice(0, 200);
  return validateProject(project);
}
