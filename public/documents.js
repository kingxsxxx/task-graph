import { escapeHtml as esc, renderMarkdown } from './markdown.js';

export const DOCUMENT_TYPES = {general:'自由文档',plan:'执行计划',roadmap:'工作路线',technical:'技术实现',verification:'验证记录',notes:'决策与交接'};
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const documentCollectionControl=value=>`<select id="documentCollection" aria-label="资料分类">${[['ordinary','工作文档'],['acceptance','阶段验收'],['acceptance-archive','已归档验收']].map(([v,label])=>`<option value="${v}" ${v===value?'selected':''}>${label}</option>`).join('')}</select>`;
export const scopeDocuments = (project, taskId = null) => project.documents.filter(d => (d.taskId ?? null) === taskId);
export function documentTemplate(type, title) {
  if (type === 'general') return '';
  const headings = {
    plan: ['目标与范围','实施步骤','完成条件'], roadmap: ['工作目标','步骤与依赖','风险与下一步'],
    technical: ['实现方案','接口与数据','关键实现细节','风险与取舍'],
    verification: ['验证目标','测试命令与步骤','实际结果','证据与遗留问题'],
    notes: ['决定与原因','已完成工作','阻塞与所需输入','下一步']
  };
  return `# ${title}\n\n${(headings[type] ?? headings.notes).map(h=>`## ${h}\n\n`).join('')}`;
}
export function renderNodeDocuments(project, taskId) {
  const docs = scopeDocuments(project, taskId);
  return `<div class="inspector-section node-documents"><div class="section-label">节点文档<span class="subtle">${docs.length} 份</span></div>
    <div class="node-doc-actions"><button class="button small ghost" data-doc-folder="${esc(taskId)}">${icon('doc')}查看文件夹</button><button class="button small ghost" data-node-doc-new="${esc(taskId)}">${icon('plus')}新建文档</button></div>
    ${docs.map(d=>`<button class="node-doc-file" data-open-doc="${esc(d.id)}">${icon('doc')}<span>${esc(d.title)}</span><small>${DOCUMENT_TYPES[d.type]}</small></button>`).join('')}</div>`;
}
export function renderTaskDocumentPicker(project, selectedIds) {
  return `<div class="inspector-section"><div class="section-label">关联文档</div>
    <details class="document-picker" data-document-picker><summary>选择关联文档 <span data-document-count>已关联 ${selectedIds.length} 份</span></summary>
    <div class="document-picker-options">${project.documents.map(d=>{
      const owner=project.tasks.find(t=>t.id===d.taskId);
      return `<div class="document-picker-row"><label class="doc-check"><input type="checkbox" data-doc-link="${esc(d.id)}" ${selectedIds.includes(d.id)?'checked':''}><span>${esc(d.title)}<small>${esc(owner?.title ?? '项目文档')}</small></span></label><button type="button" class="icon-button" data-open-doc="${esc(d.id)}" aria-label="打开文档 ${esc(d.title)}">${icon('arrow')}</button></div>`;
    }).join('') || '<p class="subtle">暂无文档，可在项目文档中按需创建。</p>'}</div></details></div>`;
}
export function renderDocumentView({project,taskId=null,draft=null,mode='split'}) {
  const docs = scopeDocuments(project,taskId), task = project.tasks.find(t=>t.id===taskId);
  const options = Object.entries(DOCUMENT_TYPES).map(([type,label])=>`<option value="${type}" ${draft?.type===type?'selected':''}>${label}</option>`).join('');
  return `<div class="document-context"><div class="document-location">${icon('doc')}<strong>${esc(task?.title ?? '项目文档')}</strong><span class="subtle">${docs.length} 份文档</span></div><div class="document-context-actions">${documentCollectionControl('ordinary')}<button class="button small ghost" data-doc-return>${icon('arrow')}返回任务图</button><button class="button small ghost" data-doc-storage>本地路径</button></div></div>
    <aside class="doc-list-panel"><div class="doc-list-top"><label class="folder-selector"><span class="subtle">所属位置</span><select id="documentScope" aria-label="所属位置"><option value="" ${taskId===null?'selected':''}>项目文档</option>${project.tasks.map(t=>`<option value="${esc(t.id)}" ${taskId===t.id?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label><button class="icon-button" data-doc-action="new" aria-label="在当前位置新建文档">${icon('plus')}</button></div>
    <label class="subtle" style="display:block;padding:8px"><span>搜索当前文件夹</span><input type="search" id="documentSearch" aria-label="搜索当前文件夹文档" placeholder="按标题或用途搜索"></label><p id="documentSearchEmpty" class="folder-empty subtle" hidden>没有匹配的文档</p>${docs.map(d=>`<button class="doc-list-item ${draft?.id===d.id?'active':''}" data-open-doc="${esc(d.id)}"><strong>${esc(d.title)}</strong><small>${DOCUMENT_TYPES[d.type]}</small></button>`).join('') || '<div class="folder-empty subtle">此位置还没有文档，可点击上方加号创建。</div>'}</aside>
    <div class="doc-editor-panel">${draft ? `<div class="doc-editor-top"><input id="docTitle" value="${esc(draft.title)}" maxlength="160" aria-label="文档标题"><select id="docType" aria-label="文档用途">${options}</select><button class="icon-button" data-doc-action="delete" aria-label="删除文档">${icon('trash')}</button><button class="button primary" data-doc-action="save">${icon('check')}保存文档</button></div>
    <div class="editor-toolbar"><div class="editor-tabs">${[['edit','编辑'],['preview','预览'],['split','分栏']].map(([m,title])=>`<button data-doc-mode="${m}" class="${mode===m?'active':''}">${title}</button>`).join('')}</div><span class="subtle">Markdown · Ctrl / ⌘ + S 保存</span></div>
    <div class="doc-content mode-${mode}"><textarea id="docContent" class="doc-textarea" aria-label="Markdown 文档内容" spellcheck="false" maxlength="500000" ${mode==='preview'?'hidden':''}>${esc(draft.content)}</textarea><article id="docPreview" class="markdown-preview" ${mode==='edit'?'hidden':''}>${renderMarkdown(draft.content)}</article></div>`
    : `<div class="doc-empty"><h3>${task?'记录这个阶段的工作':'按需创建项目文档'}</h3><button class="button primary" data-doc-action="new">${icon('plus')}新建文档</button></div>`}</div>`;
}
