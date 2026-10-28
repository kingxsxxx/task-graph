import { escapeHtml as esc, renderMarkdown } from './markdown.js';
import { DOCUMENT_TYPES, scopeDocuments, documentTemplate, renderDocumentView, renderNodeDocuments, renderTaskDocumentPicker } from './documents.js';
import { scopeAcceptanceDocuments, acceptanceTemplate, renderAcceptanceCriteria, renderNodeAcceptanceDocuments, renderAcceptanceView } from './acceptance.js';
import './dropdowns.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const statusInfo = { backlog: ['待开始', 'gray'], active: ['进行中', 'green'], review: ['待验收', 'amber'], done: ['已完成', 'blue'], blocked: ['阻塞', 'red'] };
const docTypes = DOCUMENT_TYPES;
const state = { project: null, projects: [], view: 'graph', selected: null, taskDraft: null, taskBase: null, taskDirty: false, docDraft: null, docBase: null, docDirty: false, docTaskId: null, docReturnTaskId: null, docMode: 'split', busy: false, conflict: false, query: '', filter: 'all', camera: { x: 0, y: 0, scale: 1 }, drag: null };
const taskFields = ['title', 'description', 'owner', 'status', 'criteria', 'documentIds'];
const docFields = ['title', 'type', 'content'];
state.docCollection = 'ordinary';
state.docOwnerInstance = null;
const documentRecords = () => state.docCollection === 'ordinary' ? state.project.documents : state.project.acceptanceDocuments ?? [];
const currentFolderDocuments = () => state.docCollection === 'ordinary' ? scopeDocuments(state.project,state.docTaskId) : scopeAcceptanceDocuments(state.project,state.docTaskId,{archived:state.docCollection==='acceptance-archive'});
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function reconcile(draft, baseline, latest, fields) {
  if (!draft || !baseline || !latest) return;
  for (const key of fields) if (equal(draft[key], baseline[key])) { draft[key] = structuredClone(latest[key]); baseline[key] = structuredClone(latest[key]); }
}
function changedPatch(draft, baseline, latest, fields) {
  const patch = {}, conflicts = [];
  for (const key of fields) if (!baseline || !equal(draft[key], baseline[key])) {
    patch[key] = draft[key];
    if (baseline && latest && !equal(latest[key], baseline[key]) && !equal(latest[key], draft[key])) conflicts.push(key);
  }
  if (conflicts.length) {
    const labels = { title: '名称', description: '说明', owner: '负责人', status: '状态', criteria: '验收项', documentIds: '文档关联', type: '文档类型', content: '文档内容' };
    if (!confirm(`你与其他窗口或代理都修改了：${conflicts.map(key => labels[key]).join('、')}。确认用你的草稿覆盖这些字段吗？未修改的字段会保留最新版本。`)) return null;
  }
  return patch;
}
let toastTimer, suppressClickUntil = 0, modalResolve;
function toast(message, error = false) {
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8000 : 3500);
}
const perform = work => Promise.resolve().then(work).catch(error => toast(error.message, true));
async function api(path, options = {}) {
  const response = await fetch(path, options); let data;
  try { data = await response.json(); } catch { throw new Error('服务连接中断，请确认本地服务仍在运行。'); }
  if (!response.ok) { const error = new Error(data.error ?? '操作失败'); error.status = response.status; throw error; }
  return data;
}
const post = (path, value) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
function hasDirty() { return state.taskDirty || state.docDirty; }
function discardGuard() {
  if (hasDirty() && !confirm('当前有尚未保存的编辑。离开会丢弃这些编辑，确定继续吗？')) return false;
  state.taskDirty = false; state.docDirty = false; state.taskDraft = null; state.docDraft = null; state.taskBase = null; state.docBase = null; return true;
}
function readiness(task) {
  const predecessors = state.project.edges.filter(e => e.to === task.id).map(e => state.project.tasks.find(t => t.id === e.from));
  return { predecessors, blockers: predecessors.filter(t => t.status !== 'done') };
}
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false }); }
function badge(status) { const [label, color] = statusInfo[status]; return `<span class="node-status"><i class="dot ${color}"></i>${label}</span>`; }
function syncLabel() {
  const label = state.busy ? '保存中…' : state.conflict ? '版本冲突 · 点击刷新' : hasDirty() ? '有未保存修改' : '已同步';
  $('syncState').innerHTML = `<span class="dot green"></span>${label}`;
  $('syncState').classList.toggle('conflict', state.conflict || hasDirty());
}
function setBusy(value) {
  state.busy = value;
  const shell = document.querySelector('.app-shell');
  shell.inert = value; shell.setAttribute('aria-busy', String(value));
  syncLabel();
}
async function refreshProjects() { state.projects = await api('/api/projects'); renderSidebar(); }
async function loadProject(id, preserve = false) {
  if (!preserve && !discardGuard()) return;
  const project = await api(`/api/projects/${id}`); state.project = project; state.conflict = false;
  if (!preserve) {
    state.selected = null; state.docDraft = null; state.taskDraft = null;
    state.view = 'graph'; state.query = ''; state.filter = 'all'; state.docTaskId = null; state.docReturnTaskId = null;
    $('search').value = ''; $('statusFilter').value = 'all'; closeMobileSidebar();
    state.docCollection = 'ordinary';
    const url = new URL(location.href); url.searchParams.set('project', id); history.replaceState(null, '', url);
  }
  else { if (!state.taskDirty) state.taskDraft = null; }
  if (state.selected && !project.tasks.some(t => t.id === state.selected) && !state.taskDirty) { state.selected = null; state.taskDraft = null; }
  render(); if (!preserve) requestAnimationFrame(fitGraph);
  try { localStorage.setItem('task-graph-project', id); } catch { /* Browser storage is only a convenience; server files are canonical. */ }
}
async function command(value, { resetTask = false, resetDoc = false } = {}) {
  if (state.busy) throw new Error('上一项保存仍在进行，请稍后再试。');
  setBusy(true);
  try {
    const next = await post(`/api/projects/${state.project.id}/commands`, { revision: state.project.revision, command: value });
    state.project = next; state.conflict = false;
    if (resetTask) { state.taskDraft = null; state.taskDirty = false; }
    if (resetDoc) { state.docDraft = null; state.docDirty = false; }
    render(); await refreshProjects(); return next;
  } catch (error) {
    if (error.status === 409) state.conflict = true;
    throw error;
  } finally { setBusy(false); }
}
function renderSidebar() {
  const list = $('projectList');
  const html = state.projects.map(p => `<button class="project-item ${p.id === state.project?.id ? 'selected' : ''}" data-project="${esc(p.id)}" title="${esc(p.name)}"><span class="project-square"></span><span>${esc(p.name)}</span><span class="mono">${p.doneCount}/${p.taskCount}</span></button>`).join('');
  if (list.dataset.rendered !== html) { list.innerHTML = html; list.dataset.rendered = html; }
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  $('navTaskCount').textContent = state.project?.tasks.length ?? 0; $('navDocCount').textContent = state.project?.documents.length ?? 0;
}
function renderStats() {
  const p = state.project, done = p.tasks.filter(t => t.status === 'done').length, active = p.tasks.filter(t => t.status === 'active').length;
  const blocked = p.tasks.filter(t => t.status !== 'done' && (t.status === 'blocked' || readiness(t).blockers.length)).length;
  const cards = [['阶段', p.tasks.length], ['已完成', `${done} / ${p.tasks.length}`], ['进行中', active], ['阻塞', blocked]];
  $('stats').innerHTML = cards.map((card, index) => `<article class="stat-card ${index === 1 ? 'highlight' : ''}"><span class="stat-label">${card[0]}</span><span class="stat-value">${card[1]}</span></article>`).join('');
}
function render() {
  if (!state.project) return;
  const p = state.project;
  $('crumbName').textContent = p.name; $('crumbName').title = p.description;
  $('viewLabel').textContent = { graph: '任务图谱', documents: '项目文档', activity: '活动记录' }[state.view];
  $('revisionLabel').textContent = `REV ${String(p.revision).padStart(3, '0')} · ${p.id === 'project-demo' ? 'DEMO DATA' : 'LOCAL FILES'}`;
  $('workspace').hidden = state.view !== 'graph'; $('documentsView').hidden = state.view !== 'documents'; $('activityView').hidden = state.view !== 'activity';
  renderSidebar(); renderStats(); renderGraph(); renderInspector();
  if (state.view === 'documents') renderDocuments();
  if (state.view === 'activity') renderActivity();
  syncLabel();
}
function positions() {
  const p = state.project, level = new Map(p.tasks.map(t => [t.id, 0])), incoming = new Map(p.tasks.map(t => [t.id, 0])), next = new Map(p.tasks.map(t => [t.id, []]));
  for (const edge of p.edges) { incoming.set(edge.to, incoming.get(edge.to) + 1); next.get(edge.from).push(edge.to); }
  const queue = p.tasks.filter(t => !incoming.get(t.id)).map(t => t.id);
  for (let i = 0; i < queue.length; i++) for (const id of next.get(queue[i])) { level.set(id, Math.max(level.get(id), level.get(queue[i]) + 1)); incoming.set(id, incoming.get(id) - 1); if (!incoming.get(id)) queue.push(id); }
  const groups = new Map(); for (const t of p.tasks) { const l = level.get(t.id); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(t.id); }
  const result = {};
  for (const [l, ids] of groups) ids.forEach((id, i) => { result[id] = { x: 100 + l * 325, y: 240 + (i - (ids.length - 1) / 2) * 190 }; });
  for (const t of p.tasks) if (t.position) result[t.id] = t.position;
  return result;
}
function visible(task) { return (state.filter === 'all' || task.status === state.filter) && `${task.title} ${task.owner} ${task.description}`.toLowerCase().includes(state.query.toLowerCase()); }
function connectedSet() {
  const related = new Set(); if (!state.selected) return related;
  for (const direction of ['up', 'down']) {
    const queue = [state.selected], visited = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const edge of state.project.edges) {
      const from = direction === 'up' ? edge.to : edge.from, to = direction === 'up' ? edge.from : edge.to;
      if (from === queue[i] && !visited.has(to)) { visited.add(to); queue.push(to); }
    }
    for (const id of visited) related.add(id);
  }
  return related;
}
function renderGraph() {
  if (!state.project) return;
  const p = state.project, coords = positions(), related = connectedSet();
  $('nodes').innerHTML = p.tasks.map((task, index) => {
    const count = task.criteria.filter(c => c.result === 'passed').length, point = coords[task.id];
    return `<button type="button" class="task-node status-${task.status} ${state.selected === task.id ? 'selected' : ''} ${state.selected && !related.has(task.id) ? 'dim' : ''} ${visible(task) ? '' : 'match-hidden'}" data-task="${esc(task.id)}" style="left:${point.x}px;top:${point.y}px" aria-label="${esc(task.title)}，${statusInfo[task.status][0]}，验收 ${count}/${task.criteria.length}" aria-pressed="${state.selected === task.id}"><span class="node-port in"></span><div class="node-top"><span class="node-index">STAGE ${String(index + 1).padStart(2, '0')}</span>${badge(task.status)}</div><strong class="node-title">${esc(task.title)}</strong><div class="node-meta"><span class="node-owner"><span class="owner-icon">${esc((task.owner || '—').slice(0, 1))}</span>${esc(task.owner || '未分配')}</span><span class="node-progress">${icon('check')}验收 ${count}/${task.criteria.length}</span></div><span class="node-port out"></span></button>`;
  }).join('');
  $('emptyGraph').hidden = p.tasks.length !== 0;
  $('edgeCount').textContent = `${p.edges.length} 条依赖`;
  const count = p.tasks.filter(visible).length; $('visibleCount').textContent = `${count} / ${p.tasks.length} 个阶段`;
  renderEdges(); renderMinimap(); updateCamera();
}
function renderEdges() {
  const coords = positions(), related = connectedSet();
  $('edgePaths').innerHTML = state.project.edges.map(edge => {
    const from = state.project.tasks.find(t => t.id === edge.from), to = state.project.tasks.find(t => t.id === edge.to);
    if (!visible(from) || !visible(to)) return '';
    const a = coords[edge.from], b = coords[edge.to], x1 = a.x + 248, x2 = b.x, y1 = a.y + 69, y2 = b.y + 69;
    const handle = Math.max(45, Math.abs(x2 - x1) * .45);
    const className = state.selected && related.has(edge.from) && related.has(edge.to) ? 'active' : from.status === 'done' ? 'done' : '';
    return `<path class="edge-path ${className} ${state.selected && (!related.has(edge.from) || !related.has(edge.to)) ? 'dim' : ''}" d="M${x1} ${y1}C${x1 + handle} ${y1},${x2 - handle} ${y2},${x2 - 5} ${y2}"/>`;
  }).join('');
}
function bounds() {
  const coords = positions(), tasks = state.project.tasks.filter(visible);
  if (!tasks.length) return null;
  const points = tasks.map(t => coords[t.id]);
  return { left: Math.min(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x + 248)), bottom: Math.max(...points.map(p => p.y + 145)) };
}
function renderMinimap() {
  const b = bounds(); if (!b) { $('minimap').hidden = true; return; } $('minimap').hidden = false;
  const coords = positions(), width = b.right - b.left + 60, height = b.bottom - b.top + 60;
  $('minimap').innerHTML = `<svg viewBox="${b.left - 30} ${b.top - 30} ${width} ${height}" aria-hidden="true">${state.project.edges.map(e => `<path d="M${coords[e.from].x + 248} ${coords[e.from].y + 69}L${coords[e.to].x} ${coords[e.to].y + 69}" stroke="#4d646b" stroke-width="6"/>`).join('')}${state.project.tasks.filter(visible).map(t => `<rect class="minimap-node ${t.status==='blocked'?'blocked':''} ${t.id===state.selected?'selected':''}" x="${coords[t.id].x}" y="${coords[t.id].y}" width="248" height="140" rx="15" fill="${t.id === state.selected ? '#a3f0c7' : t.status === 'blocked' ? '#89555d' : '#3b515a'}"/>`).join('')}</svg>`;
}
function updateCamera() {
  const c = state.camera; $('world').style.transform = `translate(${c.x}px,${c.y}px) scale(${c.scale})`;
  $('zoomValue').textContent = `${Math.round(c.scale * 100)}%`;
}
function fitGraph() {
  if (state.view !== 'graph' || !state.project) return;
  const b = bounds(); if (!b) return;
  const rect = $('canvas').getBoundingClientRect(); if (!rect.width) return;
  const scale = Math.min(1.1, Math.max(.2, Math.min((rect.width - 95) / (b.right - b.left), (rect.height - 160) / (b.bottom - b.top))));
  state.camera = { scale, x: (rect.width - (b.right + b.left) * scale) / 2, y: (rect.height - (b.bottom + b.top) * scale) / 2 - 12 };
  updateCamera();
}
function zoom(factor, x = $('canvas').clientWidth / 2, y = $('canvas').clientHeight / 2) {
  const c = state.camera, scale = Math.max(.2, Math.min(2.5, c.scale * factor));
  c.x = x - (x - c.x) * scale / c.scale; c.y = y - (y - c.y) * scale / c.scale; c.scale = scale; updateCamera();
}
function collectTask() {
  if (!state.taskDraft) return;
  for (const field of ['title', 'owner', 'description', 'status']) { const input = $('inspector').querySelector(`[name="${field}"]`); if (input) state.taskDraft[field] = input.value; }
}
function renderInspector() {
  const saved = state.project.tasks.find(t => t.id === state.selected);
  const task = saved ?? (state.taskDirty && state.taskDraft?.id === state.selected ? state.taskDraft : null);
  $('inspector').hidden = !task;
  if (!task) return;
  if (!state.taskDraft || state.taskDraft.id !== task.id || !state.taskDirty) { state.taskDraft = structuredClone(task); state.taskBase = structuredClone(task); }
  else reconcile(state.taskDraft, state.taskBase, saved, taskFields);
  // A deleted file cannot remain a selectable reference, even when the
  // criteria array contains local edits. Normalize only vanished links in
  // both snapshots, so this remote cleanup isn't a false overwrite conflict.
  const documentIds = new Set(state.project.documents.map(d=>d.id));
  const missingLinks = state.taskDirty && (state.taskDraft.documentIds.some(id=>!documentIds.has(id)) || state.taskDraft.criteria.some(c => (c.documentId && !documentIds.has(c.documentId)) || (c.acceptanceDocumentId && !(state.project.acceptanceDocuments ?? []).some(d=>d.id===c.acceptanceDocumentId && d.taskId===task.id && !d.archived))));
  if (missingLinks) state.missingDocumentLinks = true;
  for (const snapshot of [state.taskDraft, state.taskBase]) {
    snapshot.documentIds = snapshot.documentIds.filter(id=>documentIds.has(id));
    for (const criterion of snapshot.criteria) {
      if (criterion.documentId && !documentIds.has(criterion.documentId)) criterion.documentId = null;
      if (criterion.acceptanceDocumentId && !(state.project.acceptanceDocuments ?? []).some(d=>d.id===criterion.acceptanceDocumentId && d.taskId===task.id && !d.archived)) criterion.acceptanceDocumentId = null;
    }
  }
  if (!state.taskDirty) state.missingDocumentLinks = false;
  const draft = state.taskDraft, { blockers, predecessors } = readiness(task), passed = draft.criteria.filter(c => c.result === 'passed').length;
  $('inspector').innerHTML = `${state.missingDocumentLinks ? '<p role="status" class="subtle">关联文档已被删除，失效关联已移除；请检查草稿后保存。</p>' : ''}<div class="inspector-heading"><span class="eyebrow">STAGE DETAILS / 阶段详情</span><button class="icon-button" data-action="close" aria-label="关闭任务详情">${icon('close')}</button></div>
    <div class="inspector-body"><div class="task-id mono">${esc(task.id)}</div><label class="field"><span>阶段名称</span><input name="title" value="${esc(draft.title)}" maxlength="160" required></label><div class="field-row"><label class="field"><span>任务状态</span><select name="status">${Object.entries(statusInfo).map(([key,value])=>`<option value="${key}" ${draft.status===key?'selected':''}>${value[0]}</option>`).join('')}</select></label><label class="field"><span>负责人</span><input name="owner" value="${esc(draft.owner)}" maxlength="120" placeholder="YOU / AGENT"></label></div>
    <label class="field"><span>目标与说明 / 阻塞原因</span><textarea name="description" rows="3" maxlength="10000" placeholder="这个阶段要达成什么？">${esc(draft.description)}</textarea></label>
    <div class="readiness-note ${!blockers.length && task.status!=='blocked'?'ready':''}">${task.status==='blocked'?'此阶段被手动标记为阻塞，请记录原因。':blockers.length?`前置未完成：${blockers.map(t=>esc(t.title)).join('、')}`:task.status==='done'?'阶段已完成，验收证据已保留。':'前置条件已满足，可以推进这个阶段。'}</div>
    <div class="inspector-section"><div class="section-label">验收标准<span class="mono">${passed} / ${draft.criteria.length} PASSED</span></div>${renderAcceptanceCriteria(state.project,task.id,draft.criteria)}<button class="add-criterion" data-action="addCriterion">${icon('plus')}添加验收标准</button></div>
    <div class="inspector-section"><div class="section-label">前置依赖<button class="icon-button" data-action="connect" aria-label="添加前置依赖">${icon('plus')}</button></div>${predecessors.map(t=>`<div class="dependency-item"><i class="dot ${statusInfo[t.status][1]}"></i><button class="dependency-title" data-select-task="${esc(t.id)}">${esc(t.title)}</button><button class="icon-button" data-action="removeEdge" data-from="${esc(t.id)}" aria-label="移除对 ${esc(t.title)} 的依赖">${icon('close')}</button></div>`).join('') || '<p class="subtle" style="font-size:10px;margin:0 0 14px">无前置依赖 · 独立起点</p>'}</div>
    ${renderTaskDocumentPicker(state.project,draft.documentIds)}</div><div class="inspector-actions"><button class="button ghost small" data-action="delete" aria-label="删除阶段">${icon('trash')}</button><button class="button primary save-task" data-action="save">${icon('check')}保存阶段</button></div>`;
  if (saved) $('inspector').querySelector('.inspector-body').insertAdjacentHTML('beforeend', renderNodeDocuments(state.project, task.id));
  if (saved) $('inspector').querySelector('.inspector-body').insertAdjacentHTML('beforeend', renderNodeAcceptanceDocuments(state.project, task.id));
  if (!saved) {
    const notice = document.createElement('div'); notice.className = 'readiness-note'; notice.textContent = '原阶段已被其他窗口或代理删除。你的草稿仍在；点击保存可恢复为新阶段。';
    $('inspector').querySelector('.inspector-body').prepend(notice);
  }
}
async function selectTask(id) {
  if (id === state.selected) { focusTask(id); return; }
  if (id !== state.selected && !discardGuard()) return;
  state.selected = id; state.taskDraft = null; state.taskDirty = false; renderGraph(); renderInspector(); syncLabel(); focusTask(id);
}
function focusTask(id) {
  const point = positions()[id]; if (!point) return;
  const scale = Math.max(.9, state.camera.scale);
  state.camera = { scale, x: $('canvas').clientWidth / 2 - (point.x + 124) * scale, y: $('canvas').clientHeight / 2 - (point.y + 70) * scale };
  updateCamera();
}
async function switchView(view, docId) {
  if (view === 'documents') {
    const doc = state.project.documents.find(d=>d.id===docId);
    return openDocumentFolder(doc?.taskId ?? null, docId ?? null);
  }
  if (view === state.view) { closeMobileSidebar(); return; }
  if (!discardGuard()) return;
  state.view = view; closeMobileSidebar(); render();
  if (view === 'graph') requestAnimationFrame(fitGraph);
}
async function openDocumentFolder(taskId = null, docId = null, returnTaskId = null) {
  if (taskId && !state.project.tasks.some(t=>t.id===taskId)) throw new Error('节点已删除，请刷新后重试。');
  const selected = docId ? state.project.documents.find(d=>d.id===docId) : null;
  if (docId && !selected) throw new Error('文档已删除，请刷新后重试。');
  if (selected) taskId = selected.taskId ?? null;
  if (state.view === 'documents' && state.docCollection === 'ordinary' && state.docTaskId === taskId && (!docId || state.docDraft?.id === docId)) { closeMobileSidebar(); return; }
  if (!discardGuard()) return;
  state.docCollection = 'ordinary';
  state.docTaskId = taskId; state.docReturnTaskId = returnTaskId ?? taskId;
  state.docDraft = selected ? structuredClone(selected) : null; state.docBase = selected ? structuredClone(selected) : null;
  state.view = 'documents'; closeMobileSidebar(); render();
}
function renderDocuments() {
  const focused = document.activeElement;
  const caret = $('documentsView').contains(focused) && ['docTitle','docContent','docType','documentSearch'].includes(focused.id)
    ? {id:focused.id,start:focused.selectionStart,end:focused.selectionEnd,scroll:focused.scrollTop} : null;
  const searchContext = `${state.project.id}:${state.docCollection}:${state.docTaskId ?? ''}`;
  const searchValue = $('documentsView').dataset.searchContext === searchContext ? ($('documentSearch')?.value ?? '') : '';
  $('documentsView').dataset.searchContext = searchContext;
  const saved = documentRecords().find(d=>d.id===state.docDraft?.id);
  if (state.docCollection !== 'ordinary' && saved?.archived) state.docCollection = 'acceptance-archive';
  if (state.docCollection === 'ordinary' && state.docTaskId && !state.project.tasks.some(t=>t.id===state.docTaskId)) state.docTaskId = null;
  if (state.docCollection === 'acceptance' && state.docTaskId && !state.project.tasks.some(t=>t.id===state.docTaskId && (t.instanceId ?? null)===state.docOwnerInstance)) {
    state.docCollection = 'acceptance-archive';
    if (!state.docDirty && !saved) state.docTaskId = null;
  }
  if (state.docDirty) {
    reconcile(state.docDraft, state.docBase, saved, docFields);
    if (saved) { state.docDraft.taskId = saved.taskId ?? null; state.docTaskId = saved.taskId ?? null; }
  } else {
    const docs = currentFolderDocuments();
    const selected = docs.find(d=>d.id===state.docDraft?.id) ?? docs[0];
    state.docDraft = selected ? structuredClone(selected) : null; state.docBase = selected ? structuredClone(selected) : null;
  }
  $('documentsView').innerHTML = state.docCollection === 'ordinary'
    ? renderDocumentView({project:state.project,taskId:state.docTaskId,draft:state.docDraft,mode:state.docMode})
    : renderAcceptanceView({project:state.project,taskId:state.docTaskId,draft:state.docDraft,mode:state.docMode,archived:state.docCollection==='acceptance-archive'});
  if ($('documentSearch') && searchValue) { $('documentSearch').value = searchValue; $('documentSearch').dispatchEvent(new Event('input', {bubbles:true})); }
  if (caret) {
    const field = $(caret.id);
    if (field && !field.hidden) { field.focus({preventScroll:true}); if (typeof caret.start === 'number') field.setSelectionRange(caret.start,caret.end); field.scrollTop = caret.scroll; }
  }
}
async function returnToDocumentTask() {
  if (!discardGuard()) return;
  const id = state.docReturnTaskId, exists = state.project.tasks.some(t=>t.id===id);
  state.view = 'graph'; state.selected = exists ? id : null; render();
  requestAnimationFrame(()=>exists ? focusTask(id) : fitGraph());
  if (id && !exists) toast('原节点已删除，已返回任务图。');
}
async function showDocumentStorage(taskId = state.docTaskId) {
  const storage = await api(`/api/projects/${state.project.id}/storage`);
  const folder = state.docCollection === 'ordinary' ? (taskId ? storage.tasks.find(t=>t.taskId===taskId) : storage.projectFolder)
    : (state.docCollection==='acceptance-archive'?storage.acceptanceFolders.archived:storage.acceptanceFolders.tasks).find(t=>t.taskId===(taskId ?? state.docDraft?.taskId));
  if (!folder) throw new Error('节点已删除，请刷新后重试。');
  const promise = dialog('本地文档文件夹', '保存后路径会更新；本地文件用于查看和备份，修改请在面板保存。',
    `<label class="field"><span>当前版本目录 · REV ${storage.revision}</span><textarea id="folderPath" readonly rows="4">${esc(folder.path)}</textarea></label>${folder.exists ? '' : '<p class="subtle">此版本尚未生成节点目录；保存节点或创建文档后生成。</p>'}<button type="button" class="button ghost" id="copyFolderPath">复制路径</button>`);
  $('copyFolderPath').onclick = () => perform(async()=>{
    try { await navigator.clipboard.writeText(folder.path); $('copyFolderPath').textContent = '已复制'; }
    catch { $('folderPath').focus(); $('folderPath').select(); $('copyFolderPath').textContent = '请手动复制所选路径'; }
  });
  await promise;
}
function renderActivity() {
  const items = state.project.activity ?? [];
  $('activityView').innerHTML = `<div class="activity-heading"><h2>每一步，都有迹可循</h2><span class="subtle">最近 ${items.length} 条记录</span></div><div class="activity-list">${items.map(item => `<div class="activity-item"><span class="dot"></span><div><strong>${esc(item.text)}</strong><small>${esc(formatTime(item.at))}</small></div></div>`).join('') || '<p class="subtle" style="padding:20px">还没有操作记录。</p>'}</div>`;
}
function dialog(title, description, fields) {
  $('modalTitle').textContent = title; $('modalDescription').textContent = description; $('modalFields').innerHTML = fields; $('modal').showModal();
  return new Promise(resolve => { modalResolve = resolve; });
}
function closeDialog(value = null) { $('modal').close(); modalResolve?.(value); modalResolve = null; }
async function newProject() {
  if (!discardGuard()) return;
  const result = await dialog('开启一个新项目', '把目标拆成阶段，让下一步始终清晰。', '<label class="field"><span>项目名称</span><input name="name" required maxlength="120" placeholder="例如：构建我的研究工作台" autofocus></label><label class="field"><span>项目目标</span><textarea name="description" maxlength="5000" placeholder="最终要交付什么？"></textarea></label>');
  if (!result) return;
  const p = await post('/api/projects', result); await refreshProjects(); state.view = 'graph'; await loadProject(p.id); toast('项目已创建，开始规划第一阶段吧。');
}
async function newTask() {
  if (!discardGuard()) return;
  const result = await dialog('创建一个阶段', '一个明确的目标，一组可检验的验收标准。', '<label class="field"><span>阶段名称</span><input name="title" required maxlength="160" placeholder="例如：实现核心能力" autofocus></label><label class="field"><span>负责人</span><input name="owner" maxlength="120" placeholder="YOU / AGENT"></label><label class="field"><span>第一条验收标准（可稍后添加）</span><textarea name="criterion" maxlength="2000" placeholder="例如：关键流程可以完整运行"></textarea></label>');
  if (!result) return;
  const id = `task-${crypto.randomUUID()}`, criteria = result.criterion.trim() ? [{ id: `check-${crypto.randomUUID()}`, text: result.criterion, result: 'pending', evidence: '' }] : [];
  await command({ type: 'createTask', task: { id, title: result.title, owner: result.owner, criteria } });
  state.view = 'graph'; state.selected = id; state.taskDraft = null; render(); requestAnimationFrame(fitGraph); toast('阶段已创建');
}
async function connectTasks(toId = state.selected) {
  if (state.project.tasks.length < 2) { toast('至少创建两个阶段后才能连接。'); return; }
  const options = selected => state.project.tasks.map(t => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.title)}</option>`).join('');
  const firstOther = state.project.tasks.find(t => t.id !== toId)?.id;
  const result = await dialog('连接阶段依赖', '前置阶段完成后，后续阶段才能推进。系统会检查并拒绝形成环的连接。', `<label class="field"><span>前置阶段</span><select name="from">${options(firstOther)}</select></label><div style="text-align:center;color:#719b89;margin-bottom:12px">↓ 必须先完成</div><label class="field"><span>后续阶段</span><select name="to">${options(toId)}</select></label>`);
  if (result) { await command({ type: 'addEdge', ...result }); toast('依赖已建立'); }
}
async function newDocument(taskId = state.docTaskId) {
  if (taskId && !state.project.tasks.some(t=>t.id===taskId)) throw new Error('节点已删除，请刷新后重试。');
  if (hasDirty() && !confirm('当前有尚未保存的编辑。创建文档会离开这些编辑，确定继续吗？')) return;
  const task = state.project.tasks.find(t=>t.id===taskId);
  const result = await dialog(task ? '新建节点文档' : '新建项目文档', task?.title ?? '项目级文档',
    `<label class="field"><span>文档标题</span><input name="title" required maxlength="160" placeholder="例如：项目大纲" autofocus></label><label class="field"><span>文档用途</span><select name="type">${Object.entries(docTypes).map(([type,label])=>`<option value="${type}">${label}</option>`).join('')}</select></label><label class="template-choice"><input type="checkbox" name="template" checked>使用所选用途的内容模板</label>`);
  if (!result) return;
  const id = `doc-${crypto.randomUUID()}`;
  await command({type:'saveDocument',document:{id,title:result.title,type:result.type,taskId,content:result.template?documentTemplate(result.type,result.title):''}},{resetTask:true,resetDoc:true});
  state.docCollection = 'ordinary';
  state.docTaskId = taskId; state.docReturnTaskId = taskId; state.view = 'documents';
  state.docDraft = structuredClone(state.project.documents.find(d=>d.id===id)); state.docBase = structuredClone(state.docDraft); render(); toast('文档已创建');
}
async function saveTask() {
  collectTask(); const draft = state.taskDraft;
  const saved = state.project.tasks.find(t => t.id === draft.id);
  if (!saved) {
    if (!confirm('原阶段已被其他窗口或代理删除。将保留的草稿保存为一个新阶段吗？')) return false;
    const id = `task-${crypto.randomUUID()}`;
    const task = Object.fromEntries(taskFields.map(key => [key, draft[key]]));
    task.criteria = task.criteria.map(c=>({...c,acceptanceDocumentId:null,documentId:null}));
    await command({ type: 'createTask', task: { ...task, id, documentIds: draft.documentIds.filter(id => state.project.documents.some(d => d.id === id)) } }, { resetTask: true });
    state.selected = id; render(); toast('草稿已恢复为新阶段'); return true;
  }
  const patch = changedPatch(draft, state.taskBase, saved, taskFields); if (!patch) return false;
  await command({ type: 'updateTask', id: draft.id, patch }, { resetTask: true }); toast('阶段与验收记录已保存');
  return true;
}
async function openAcceptanceFolder(taskId,docId=null,returnTaskId=null,{archived=false}={}) {
  const selected=(state.project.acceptanceDocuments ?? []).find(d=>d.id===docId);
  if (docId && !selected) throw new Error('验收文档已删除，请刷新后重试。');
  if (selected) { archived=selected.archived; taskId=selected.taskId; }
  if (!archived && !state.project.tasks.some(t=>t.id===taskId)) throw new Error('请选择一个现有节点。');
  const collection=archived?'acceptance-archive':'acceptance';
  if (state.view==='documents' && state.docCollection===collection && state.docTaskId===taskId && (!docId || state.docDraft?.id===docId)) return;
  if (!discardGuard()) return;
  state.docCollection=collection;state.docTaskId=taskId;state.docReturnTaskId=returnTaskId ?? (archived?null:taskId);
  state.docOwnerInstance=state.project.tasks.find(t=>t.id===taskId)?.instanceId ?? null;
  state.docDraft=selected?structuredClone(selected):null;state.docBase=selected?structuredClone(selected):null;state.view='documents';closeMobileSidebar();render();
}
async function prepareAcceptanceAction(taskId) {
  if (!state.project.tasks.some(t=>t.id===taskId)) throw new Error('节点已删除，请刷新后重试。');
  if (state.taskDirty) {
    if (!confirm('新建或转换验收文档前需要先保存阶段修改，是否保存并继续？')) return false;
    if (!await saveTask()) return false;
    if (!state.project.tasks.some(t=>t.id===taskId)) throw new Error('原节点已删除，不能给新节点关联旧验收资料。');
  }
  if (state.docDirty && !confirm('当前文档有未保存的修改，创建后将离开这些编辑，确定继续吗？')) return false;
  return true;
}
async function newAcceptanceDocument(taskId,criterionId=null) {
  if (!await prepareAcceptanceAction(taskId)) return;
  const task=state.project.tasks.find(t=>t.id===taskId),criterion=task.criteria.find(c=>c.id===criterionId);
  if (criterionId && !criterion) throw new Error('验收项已删除，请先保存有效验收项。');
  const title=(criterion?`${criterion.text}｜验收记录`:'验收记录').slice(0,160);
  const result=await dialog('新建节点验收文档',task.title,`<label class="field"><span>文档标题</span><input name="title" value="${esc(title)}" maxlength="160" required autofocus></label><label class="template-choice"><input type="checkbox" name="template" checked>使用验收记录模板</label>`);
  if (!result) return;
  const id=`acceptance-${crypto.randomUUID()}`;
  await command({type:'saveAcceptanceDocument',document:{id,taskId,title:result.title,content:result.template?acceptanceTemplate(result.title):''},...(criterionId?{criterionId}:{})},{resetTask:true,resetDoc:true});
  await openAcceptanceFolder(taskId,id,taskId);toast('节点验收文档已创建');
}
async function convertAcceptanceDocument(taskId,criterionId,documentId) {
  if (!confirm('复制原普通文档为本节点的独立验收文档？原件保留，之后两份正文独立维护。')) return;
  if (!await prepareAcceptanceAction(taskId)) return;
  const next=await command({type:'convertAcceptanceDocument',taskId,criterionId,documentId},{resetTask:true,resetDoc:true});
  const linked=next.tasks.find(t=>t.id===taskId).criteria.find(c=>c.id===criterionId).acceptanceDocumentId;
  await openAcceptanceFolder(taskId,linked,taskId);toast('已复制为独立验收文档，原件保留');
}
async function saveDocument() {
  if (!state.docDraft) return;
  if (state.docCollection === 'acceptance-archive') { toast('归档验收文档只读，草稿可以复制。'); return; }
  const acceptance = state.docCollection === 'acceptance';
  const draft = state.docDraft, saved = documentRecords().find(d=>d.id===draft.id);
  let id = draft.id, owner = saved ? saved.taskId ?? null : draft.taskId ?? null;
  if (acceptance && (!state.project.tasks.some(t=>t.id===owner && (t.instanceId ?? null)===state.docOwnerInstance) || saved?.archived)) { toast('原节点已删除或重建；验收草稿仍保留，请复制正文。',true); return; }
  if (!saved) {
    if (!confirm('原文档已被其他窗口或代理删除。将保留的草稿恢复为新文档吗？')) return;
    id = `${acceptance?'acceptance':'doc'}-${crypto.randomUUID()}`; if (!state.project.tasks.some(t=>t.id===owner)) owner = null;
  }
  const patch = changedPatch(draft, state.docBase, saved, docFields); if (!patch) return;
  await command({type:acceptance?'saveAcceptanceDocument':'saveDocument',document:{...(saved ?? draft),...patch,id,taskId:owner}},{resetDoc:true});
  state.docTaskId = owner; state.docDraft = structuredClone(documentRecords().find(d=>d.id===id)); state.docBase = structuredClone(state.docDraft);
  renderDocuments(); toast(saved ? '文档已保存为 Markdown' : '草稿已恢复为新文档');
}
async function exportProject() {
  if (hasDirty()) toast('导出的是已保存版本；未保存的编辑不会包含在文件中。');
  const p = await api(`/api/projects/${state.project.id}/export`), blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${p.name.replace(/[<>:"/\\|?*]/g, '_')}-task-graph.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('newProject').onclick = () => perform(newProject); $('newTask').onclick = () => perform(newTask); $('emptyNewTask').onclick = () => perform(newTask);
$('newDocSide').onclick = () => perform(()=>newDocument(null)); $('connectTasks').onclick = () => perform(() => connectTasks());
$('exportProject').onclick = () => perform(exportProject); $('importProject').onclick = () => { if (discardGuard()) $('importFile').click(); };
$('importFile').onchange = () => perform(async () => {
  const file = $('importFile').files[0]; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('导入文件不能超过 8 MB');
    let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('这不是有效的 JSON 项目文件'); }
    const project = await post('/api/import', data); await refreshProjects(); await loadProject(project.id); toast('已作为新项目导入，原项目保留。');
  } finally { $('importFile').value = ''; }
});
$('autoLayout').onclick = () => perform(async () => { await command({ type: 'autoLayout' }); fitGraph(); toast('任务图已按依赖重新整理'); });
const sidebarMedia = matchMedia('(max-width: 800px)');
function updateSidebarToggle() {
  const expanded = sidebarMedia.matches ? $('sidebar').classList.contains('open') : document.documentElement.dataset.sidebar !== 'collapsed';
  const label = sidebarMedia.matches ? (expanded ? '收起导航' : '展开导航') : (expanded ? '隐藏侧边栏' : '显示侧边栏');
  $('menuToggle').setAttribute('aria-controls', 'sidebar');
  $('menuToggle').setAttribute('aria-expanded', String(expanded));
  $('menuToggle').setAttribute('aria-label', label); $('menuToggle').title = label;
  $('sidebar').inert = !expanded; $('sidebar').setAttribute('aria-hidden', String(!expanded));
}
function closeMobileSidebar() { $('sidebar').classList.remove('open'); updateSidebarToggle(); }
$('menuToggle').onclick = () => {
  if (sidebarMedia.matches) $('sidebar').classList.toggle('open');
  else {
    const collapsed = document.documentElement.dataset.sidebar !== 'collapsed';
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
    try { localStorage.setItem('task-graph-sidebar-collapsed', String(collapsed)); } catch {}
  }
  updateSidebarToggle();
};
sidebarMedia.addEventListener('change', closeMobileSidebar);
updateSidebarToggle();
$('projectToggle').onclick = () => {
  const expanded = $('projectToggle').getAttribute('aria-expanded') !== 'true';
  $('projectToggle').setAttribute('aria-expanded', String(expanded)); $('projectList').hidden = !expanded;
};
$('themeToggle').value = document.documentElement.dataset.theme;
$('themeToggle').onchange = event => {
  event.target.value = window.taskGraphTheme.apply(event.target.value,true);
};
$('syncState').onclick = () => perform(async () => { await loadProject(state.project.id, true); await refreshProjects(); toast(hasDirty() ? '已读取最新版本，你的未保存编辑仍保留；请核对后保存。' : '已读取最新项目版本'); });
$('sidebar').onclick = event => {
  const view = event.target.closest('[data-view]'), project = event.target.closest('[data-project]'), doc = event.target.closest('[data-doc]');
  if (view) perform(() => switchView(view.dataset.view));
  if (project) perform(() => loadProject(project.dataset.project));
  if (doc) perform(() => switchView('documents', doc.dataset.doc));
};
$('modalForm').onsubmit = event => { event.preventDefault(); closeDialog(Object.fromEntries(new FormData(event.currentTarget))); };
$('modalCancel').onclick = () => closeDialog(); $('modalClose').onclick = () => closeDialog();
$('modal').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
$('search').oninput = event => { state.query = event.target.value; renderGraph(); };
$('statusFilter').onchange = event => { state.filter = event.target.value; renderGraph(); fitGraph(); };
$('fitGraph').onclick = fitGraph; $('minimap').onclick = fitGraph; $('zoomIn').onclick = () => zoom(1.2); $('zoomOut').onclick = () => zoom(1 / 1.2);
$('canvas').addEventListener('wheel', event => { event.preventDefault(); const r = $('canvas').getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX - r.left, event.clientY - r.top); }, { passive: false });
$('nodes').onclick = event => { const node = event.target.closest('[data-task]'); if (node && Date.now() > suppressClickUntil) perform(() => selectTask(node.dataset.task)); };
$('canvas').addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.busy || event.target.closest('.canvas-controls,.minimap,.empty-state')) return;
  const node = event.target.closest('[data-task]');
  const start = { clientX: event.clientX, clientY: event.clientY, x: state.camera.x, y: state.camera.y, moved: false, target: node ?? $('canvas') };
  if (node) { const id = node.dataset.task; const p = positions()[id]; start.id = id; start.point = { ...p }; start.previousPosition = structuredClone(state.project.tasks.find(t => t.id === id).position); }
  state.drag = start; start.target.setPointerCapture(event.pointerId);
});
$('canvas').addEventListener('pointermove', event => {
  const drag = state.drag; if (!drag) return;
  const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
  if (Math.abs(dx) + Math.abs(dy) < 5 && !drag.moved) return; drag.moved = true;
  if (drag.id) {
    const point = { x: Math.round(drag.point.x + dx / state.camera.scale), y: Math.round(drag.point.y + dy / state.camera.scale) };
    state.project.tasks.find(t => t.id === drag.id).position = point; drag.target.style.left = point.x + 'px'; drag.target.style.top = point.y + 'px'; renderEdges();
  } else { state.camera.x = drag.x + dx; state.camera.y = drag.y + dy; updateCamera(); }
});
function endDrag(cancelled = false) {
  const drag = state.drag; if (!drag) return; state.drag = null;
  if (drag.moved) suppressClickUntil = Date.now() + 150;
  if (drag.id && drag.moved) {
    if (cancelled) { state.project.tasks.find(t => t.id === drag.id).position = drag.previousPosition; renderGraph(); return; }
    const position = state.project.tasks.find(t => t.id === drag.id).position;
    perform(async () => { try { await command({ type: 'updateTask', id: drag.id, patch: { position } }); } catch (error) { state.project.tasks.find(t => t.id === drag.id).position = drag.previousPosition; renderGraph(); throw error; } });
  }
}
$('canvas').addEventListener('pointerup', () => endDrag()); $('canvas').addEventListener('pointercancel', () => endDrag(true));
$('canvas').addEventListener('keydown', event => {
  if (event.target !== $('canvas')) return;
  const keys = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
  if (keys[event.key]) { event.preventDefault(); state.camera.x += keys[event.key][0]; state.camera.y += keys[event.key][1]; updateCamera(); }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
  if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
  if (event.key.toLowerCase() === 'f') fitGraph();
});
$('inspector').addEventListener('input', event => {
  if (!state.taskDraft) return; collectTask();
  const item = event.target.closest('[data-criterion]');
  if (item && event.target.dataset.criterionField) {
    const criterion = state.taskDraft.criteria.find(c => c.id === item.dataset.criterion);
    const field = event.target.dataset.criterionField;
    criterion[field] = field === 'acceptanceDocumentId' ? event.target.value || null : event.target.value;
    if (field === 'acceptanceDocumentId') {
      criterion.documentId=null;item.querySelector('.legacy-acceptance')?.remove();
      const doc = (state.project.acceptanceDocuments ?? []).find(d=>d.id===criterion.acceptanceDocumentId), open = item.querySelector('[data-criterion-open]');
      open.hidden = !doc; open.dataset.openAcceptance = doc?.id ?? ''; open.setAttribute('aria-label', `打开验收文档 ${doc?.title ?? ''}`);
    }
    item.classList.remove('passed', 'failed', 'pending'); item.classList.add(criterion.result);
  }
  if (event.target.dataset.docLink) {
    const id = event.target.dataset.docLink; state.taskDraft.documentIds = state.taskDraft.documentIds.filter(value => value !== id); if (event.target.checked) state.taskDraft.documentIds.push(id);
    $('inspector').querySelector('[data-document-count]').textContent = `已关联 ${state.taskDraft.documentIds.length} 份`;
  }
  state.taskDirty = true; syncLabel();
});
$('inspector').onclick = event => perform(async () => {
  const acceptanceFolder=event.target.closest('[data-acceptance-folder]'),acceptanceNew=event.target.closest('[data-acceptance-new]'),acceptanceFile=event.target.closest('[data-open-acceptance]'),conversion=event.target.closest('[data-convert-acceptance]'),clear=event.target.closest('[data-clear-legacy]');
  if (acceptanceFolder) return openAcceptanceFolder(acceptanceFolder.dataset.acceptanceFolder);
  if (acceptanceNew) return newAcceptanceDocument(acceptanceNew.dataset.acceptanceNew,acceptanceNew.dataset.forCriterion ?? null);
  if (acceptanceFile) return openAcceptanceFolder(state.selected,acceptanceFile.dataset.openAcceptance,state.selected);
  if (conversion) return convertAcceptanceDocument(state.selected,conversion.dataset.convertAcceptance,conversion.dataset.sourceDoc);
  if (clear) {collectTask();state.taskDraft.criteria.find(c=>c.id===clear.dataset.clearLegacy).documentId=null;state.taskDirty=true;renderInspector();syncLabel();return;}
  const folder = event.target.closest('[data-doc-folder]'), create = event.target.closest('[data-node-doc-new]'), file = event.target.closest('[data-open-doc]');
  if (folder) return openDocumentFolder(folder.dataset.docFolder);
  if (create) return newDocument(create.dataset.nodeDocNew);
  if (file) return openDocumentFolder(null,file.dataset.openDoc,state.selected);
  const select = event.target.closest('[data-select-task]'); if (select) { await selectTask(select.dataset.selectTask); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  switch (button.dataset.action) {
    case 'close': if (discardGuard()) { state.selected = null; renderGraph(); renderInspector(); syncLabel(); } break;
    case 'save': await saveTask(); break;
    case 'addCriterion': collectTask(); state.taskDraft.criteria.push({ id: `check-${crypto.randomUUID()}`, text: '', result: 'pending', evidence: '' }); state.taskDirty = true; renderInspector(); syncLabel(); break;
    case 'removeCriterion': collectTask(); state.taskDraft.criteria = state.taskDraft.criteria.filter(c => c.id !== button.dataset.id); state.taskDirty = true; renderInspector(); syncLabel(); break;
    case 'connect': await connectTasks(state.selected); break;
    case 'removeEdge': if (confirm('移除这条前置依赖？')) { await command({ type: 'removeEdge', from: button.dataset.from, to: state.selected }); toast('依赖已移除'); } break;
    case 'delete': {
      const task = state.project.tasks.find(t => t.id === state.selected), outgoing = state.project.edges.filter(e => e.from === task.id).length;
      if (confirm(`删除「${task.title}」及其连接？${outgoing ? `它是 ${outgoing} 个阶段的前置任务。` : ''}普通文档保留到项目文档，验收文档独立归档。历史快照仍保留。`)) { await command({ type: 'deleteTask', id: task.id }, { resetTask: true }); state.selected = null; render(); toast('阶段已删除'); } break;
    }
  }
});
$('documentsView').addEventListener('change', event => {
  if (event.target.id === 'documentCollection') {
    const next=event.target.value;event.target.value=state.docCollection;
    if(next==='ordinary') perform(()=>openDocumentFolder(null));
    else if(next==='acceptance-archive') perform(()=>openAcceptanceFolder(null,null,null,{archived:true}));
    else perform(()=>openAcceptanceFolder(state.project.tasks.some(t=>t.id===state.docTaskId)?state.docTaskId:state.project.tasks[0]?.id));
  }
  if (event.target.id === 'documentScope') {
    const previous = state.docTaskId ?? ''; const next = event.target.value || null;
    event.target.value = previous; perform(()=>state.docCollection==='ordinary'?openDocumentFolder(next):openAcceptanceFolder(next,null,state.docReturnTaskId,{archived:state.docCollection==='acceptance-archive'}));
  }
});
$('documentsView').addEventListener('input', event => {
  if (event.target.id === 'documentSearch') {
    const query = event.target.value.trim().toLocaleLowerCase();
    const items = [...$('documentsView').querySelectorAll('.doc-list-item')];
    for (const item of items) item.hidden = !item.textContent.toLocaleLowerCase().includes(query);
    $('documentSearchEmpty').hidden = !query || items.some(item=>!item.hidden);
    return;
  }
  if (!state.docDraft) return;
  const fields = { docTitle: 'title', docType: 'type', docContent: 'content' };
  if (fields[event.target.id]) { state.docDraft[fields[event.target.id]] = event.target.value; state.docDirty = true; syncLabel(); if (event.target.id === 'docContent') $('docPreview').innerHTML = renderMarkdown(state.docDraft.content); }
});
$('documentsView').onclick = event => perform(async () => {
  const acceptanceOpen=event.target.closest('[data-open-acceptance]');
  if (acceptanceOpen && state.docDraft?.id!==acceptanceOpen.dataset.openAcceptance) return openAcceptanceFolder(state.docTaskId,acceptanceOpen.dataset.openAcceptance,state.docReturnTaskId,{archived:state.docCollection==='acceptance-archive'});
  if (event.target.closest('[data-copy-acceptance]')) {
    try { await navigator.clipboard.writeText(state.docDraft.content);toast('验收正文已复制'); }
    catch { await dialog('复制验收正文','可手动选择并复制原始 Markdown。',`<textarea id="acceptanceCopy" readonly rows="10">${esc(state.docDraft.content)}</textarea>`); }
    return;
  }
  const open = event.target.closest('[data-open-doc]'), mode = event.target.closest('[data-doc-mode]'), action = event.target.closest('[data-doc-action]');
  if (event.target.closest('[data-doc-return]')) return returnToDocumentTask();
  if (event.target.closest('[data-doc-storage]')) return showDocumentStorage();
  if (open && state.docDraft?.id !== open.dataset.openDoc) return openDocumentFolder(state.docTaskId,open.dataset.openDoc,state.docReturnTaskId);
  if (mode) { state.docMode = mode.dataset.docMode; renderDocuments(); }
  if (action?.dataset.docAction === 'new') {
    if(state.docCollection==='ordinary') await newDocument();
    else if(state.docCollection==='acceptance') await newAcceptanceDocument(state.docTaskId);
  }
  if (action?.dataset.docAction === 'save') await saveDocument();
  if (action?.dataset.docAction === 'delete' && confirm('删除此文档及其关联？验收标准、结果、证据与历史快照仍保留。')) { await command({ type: state.docCollection==='ordinary'?'deleteDocument':'deleteAcceptanceDocument', id: state.docDraft.id }, { resetDoc: true }); toast('文档已删除'); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const picker = $('inspector').querySelector('[data-document-picker][open]');
    if (picker && picker.contains(document.activeElement)) { picker.open = false; picker.querySelector('summary').focus(); }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (state.view === 'documents') perform(saveDocument); else if (state.taskDraft) perform(saveTask); }
});
window.addEventListener('beforeunload', event => { if (hasDirty()) { event.preventDefault(); event.returnValue = ''; } });
new ResizeObserver(() => { if (!state.drag) fitGraph(); }).observe($('canvas'));
setInterval(() => perform(async () => {
  if (!state.project || state.busy || state.drag || $('modal').open) return;
  const list = await api('/api/projects'); const current = list.find(p => p.id === state.project.id);
  if (current && current.revision !== state.project.revision) {
    const dirty = hasDirty();
    await loadProject(current.id, true);
    if (dirty) { state.conflict = true; syncLabel(); }
  }
  state.projects = list; renderSidebar();
}), 6000);
perform(async () => {
  await refreshProjects(); let saved; try { saved = localStorage.getItem('task-graph-project'); } catch {}
  const requested = new URL(location.href).searchParams.get('project');
  const id = state.projects.some(p => p.id === requested) ? requested : state.projects.some(p => p.id === saved) ? saved : state.projects[0]?.id;
  if (id) await loadProject(id); else toast('没有项目，请先创建一个。');
});
