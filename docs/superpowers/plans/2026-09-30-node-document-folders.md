# Node Document Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为每个阶段节点提供独立真实 Markdown 文档目录，复用现有编辑器，并保留项目级文档与版本安全。

**Architecture:** 文档仍保存在 `project.documents`，以可选 `taskId` 区分归属。存储层按归属生成版本目录文件，新增只读路径接口；前端在现有文档页增加目录上下文，纯渲染与模板独立为小模块。所有写入继续经过项目版本校验和 `HEAD` 原子提交。

**Tech Stack:** Node.js >=22、ES modules、原生 HTML/CSS/JavaScript、node:test、Playwright Chromium；无新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-09-30-node-document-folders-design.md`（用户已确认）

## Global Constraints

- 第一版范围为一个项目内的“项目文档 + 节点文档”两级结构，不开发通用文件管理器、任意嵌套子目录、附件上传或同步服务。
- 第一版不提供外部文件编辑的自动双向同步；删除节点时保留其文档，不级联删除。
- 文档总数上限从 100 提升至 1000；单文档内容上限 500000 字符、项目完整备份 7 MB、HTTP 请求 8 MB 保持不变。
- 节点引用数量上限仍为 100；专属文档不需要重复加入 `documentIds`。
- 文档类型保留 `plan`、`roadmap`、`notes`，新增 `technical`、`verification`。
- 所有 Markdown 文件与快照写入完成后才切换 `HEAD`。旧版本不重写、不清理。
- 路径使用经过校验的不可变 ID，不使用节点或文档标题。
- 测试用临时数据，不修改用户实际项目；不自动给现有节点写未经讨论的技术方案。
- 当前 `/home/projects/task-graph` 不是 Git 仓库，不初始化仓库，不伪称提交；每任务用执行记录代替 commit。

## Review Focus

- 旧客户端编辑节点文档但不传 `taskId`：原归属不能丢失。（Task 1）
- 节点删除与另一窗口的文档草稿并存：保留内容，采用最新全局归属，不重新挂到已删除节点。（Task 4）
- 路径接口与写入同时发生：只返回同一次读取 `HEAD` 的快照和路径，不混合两个版本。（Task 2）
- 文档所属节点被删、文档本身又被删：恢复草稿须确认，用新 ID 和有效归属，不静默复活。（Task 4）
- 老版本没有节点目录：路径显示应明确目录尚未生成，读取不改写旧快照。（Task 2）

---

## Files and Responsibilities

- `src/model.mjs`：归属校验、类型/数量约束、保存兼容和删除保留。
- `src/store.mjs`：一次读取已提交版本、生成目录、文件写入及路径元数据。
- `src/http.mjs`：只读 storage 路由和新前端模块静态白名单。
- Create `public/documents.js`：纯文档目录过滤、中文类型、模板、文档页与节点文档区域的 HTML 渲染；不访问网络或维护全局状态。
- `public/app.js`：文档上下文、节点入口、导航、草稿/冲突与路径弹窗的行为编排。
- `public/refinement.css`：新文档控件的紧凑布局与深浅主题/手机适配；尽量不修改原始压缩 CSS。
- Create `tests/node-documents.test.mjs`：归属模型与纯前端模块测试。
- Create `tests/node-document-storage.test.mjs`：临时目录、路径 API 与存储失败测试。
- Create `tests/node-documents.spec.mjs`：独立临时服务的真实浏览器测试；沿用现有 Playwright 配置。
- `README.md`、`AGENT_GUIDE.md`、`docs/progress.md`：用户/代理使用说明及实际验证记录。

## Task 1: Document Ownership and Compatibility

**Files:** Modify `src/model.mjs`; create `tests/node-documents.test.mjs`.

**Interfaces:**
- Consumes existing `validateProject(project)` and `applyCommand(project, command)`.
- Produces validated documents `{id,title,type,content,taskId?:string|null,updatedAt?}`.
- `saveDocument.document.taskId` only sets ownership on creation; omitted ownership on update preserves it, explicit different ownership throws `AppError`.
- `deleteTask` clears owned documents' `taskId` to `null`, preserving document IDs/content and other tasks' references.

- [x] **Step 1: Add ownership and compatibility tests.** Construct a minimal valid project with two backlog tasks `a`, `b`; assert the following command sequence:

```js
const owned = applyCommand(p, {type:'saveDocument', document:{id:'doc-a', title:'路线', type:'roadmap', content:'# A', taskId:'a'}});
const saved = applyCommand(owned, {type:'saveDocument', document:{id:'doc-a', title:'技术', type:'technical', content:'# A2'}});
assert.equal(saved.documents.find(d => d.id === 'doc-a').taskId, 'a');
assert.throws(() => applyCommand(saved, {type:'saveDocument', document:{id:'doc-a', title:'移动', type:'notes', content:'', taskId:'b'}}));
assert.equal(applyCommand(saved, {type:'deleteTask', id:'a'}).documents[0].taskId, null);
```

- [x] **Step 2: Add validation tests.** Assert missing/null owners and all five types pass; unknown owner, `../../bad` owner, invalid type and 1001 documents fail. Assert 101 small documents pass, 500001-character content fails, 101 references fail, and deleting a node preserves another node's reference to its former owned document.
- [x] **Step 3: Run red tests.** `node --test tests/node-documents.test.mjs`; expect new ownership/type/limit cases to fail against current implementation.
- [x] **Step 4: Implement model rules.** In `validateProject` set document count 1000 and validate each non-null owner against task IDs; extend types. In `applyCommand` preserve ownership for omitted updates, reject explicit ownership changes, and detach ownership atomically on node deletion. Do not reinterpret missing ownership as belonging to a selected node.
- [x] **Step 5: Add generated combination test.** For 40 deterministic DAG fixtures with a mix of global and owned documents, delete one backlog node; assert original input is unchanged, result validates, remaining document owners exist and all references resolve.
- [x] **Step 6: Verify and record.** `npm test`; all old and new tests pass. Record real command/result in `docs/progress.md` without a Git commit.

## Task 2: Versioned Folders and Storage API

**Files:** Modify `src/store.mjs`, `src/http.mjs`; create `tests/node-document-storage.test.mjs`.

**Interfaces:**
- Consumes Task 1's optional document `taskId`.
- Add `Store.readCommitted(id) -> Promise<{project, generation, root}>`, where `root` is the absolute project directory and generation is read exactly once from `HEAD`; `get(id)` returns its `project`.
- Add `Store.writeArtifacts(destination, project) -> Promise<void>` for per-version directories, Markdown and snapshot writing. `commit` calls it before switching `HEAD`.
- Add `Store.storage(id) -> Promise<{projectId,revision,generation,projectFolder,tasks,documents}>`.
- `projectFolder:{path,exists}`; `tasks:[{taskId,path,exists}]`; `documents:[{documentId,taskId:null|string,path}]`. Paths are absolute; all entries derive from the single `readCommitted` result. No paths in exported snapshots.
- `GET /api/projects/<projectId>/storage` returns this object, under existing host/origin/read-only protections.

- [x] **Step 1: Write filesystem tests.** With temporary storage create global `g`, owned `da` for `a`, owned `db` for `b`; read returned paths and assert exact UTF-8 content, independent directories, and an empty folder for a third task. Rename title to `中文 / 重名` and assert ID-based relative location is unchanged.
- [x] **Step 2: Write consistency and compatibility tests.** Create a legacy generation with flat global documents and no task folders; assert `storage` reports task `exists:false`, returns the same revision and does not alter `HEAD`. Simulate a newer commit between `readCommitted` return and metadata creation; assert the returned generation, snapshot revision and paths still match the earlier committed generation. Reopen Store and assert all owned content survives.
- [x] **Step 3: Write failure tests.** Use a test-only Store subclass overriding `writeArtifacts` to call the real method then throw before pointer switching; assert rejected command leaves `HEAD`, current revision and readable old Markdown unchanged. Invalid owner/path commands must not create directories outside project generations.
- [x] **Step 4: Run red tests.** `node --test tests/node-document-storage.test.mjs`; expect missing `storage`/new layout failures.
- [x] **Step 5: Implement storage methods.** Use `resolve`, `join` and `safeId`; create global directory and each task's `documents/` directory, write each document only under its owner and write snapshot. Use `access` for legacy `exists` values, distinguishing ENOENT from other errors. Keep `HEAD` update last.
- [x] **Step 6: Implement HTTP route.** Match `/storage` before current project/export route; 404 for missing project, no generic filesystem serving and no path parameter. Add API assertions for normal response, encoded unsafe IDs, and unknown project.
- [x] **Step 7: Verify export/import/delete lifecycle.** Import owned-document snapshot as new project; assert ownership persists but all returned paths point inside the new project. Delete owner; assert its document now exists in global directory, prior generation still has the old file, no duplicate global/node files in the current version. Run `npm test`, record results.

## Task 3: Focused Document Rendering and Templates

**Files:** Create `public/documents.js`; extend `tests/node-documents.test.mjs`; modify `src/http.mjs` static whitelist.

**Interfaces:**
- Export `DOCUMENT_TYPES` with `plan:'执行计划'`, `roadmap:'工作路线'`, `technical:'技术实现'`, `verification:'验证记录'`, `notes:'决策与交接'`.
- Export `scopeDocuments(project, taskId = null) -> Document[]`: no owner means global, otherwise exact owner match.
- Export `documentTemplate(type, title) -> string`: Markdown heading plus purpose-specific section headings; `notes` includes decision/reason/blocker/next step, `verification` includes command/result/evidence. No template creation outside explicit new-document action.
- Export `renderDocumentView({project,taskId,draft,mode}) -> string` and `renderNodeDocuments(project,taskId) -> string` using existing escaped Markdown helpers; no network/DOM writes.
- Maintain current editor IDs (`docTitle`, `docType`, `docContent`, `docPreview`) and existing document action attributes. Add `#documentScope` select (global option `''`), `[data-doc-folder]` for entry, `[data-node-doc-new]`, `[data-doc-return]`, `[data-doc-storage]`.

- [x] **Step 1: Write pure tests.** Assert global/owned/empty folders filter correctly; titles such as `<img src=x onerror=alert(1)>` are escaped in markup; each type has its exact Chinese label and expected headings; rendering an empty folder emits no document/placeholder file.
- [x] **Step 2: Run red tests.** `node --test tests/node-documents.test.mjs`; expect missing module/exports failures.
- [x] **Step 3: Implement module.** Reuse document editor/list markup, add compact scope select and return/path controls. Node region renders count and file buttons, never global references. Rendering never resets drafts; app orchestrates selected document separately.
- [x] **Step 4: Add module static route and test.** `/documents.js` must return 200 `text/javascript`, retain existing CSP, and cannot expose `src` modules. Run `npm test` and record results.

## Task 4: Node Navigation, Draft Safety and Path Dialog

**Files:** Modify `public/app.js`, `public/refinement.css`; create `tests/node-documents.spec.mjs`.

**Interfaces:**
- Consumes Task 3 render/template exports and Task 2's storage endpoint.
- Add `state.docTaskId:string|null`, `state.docReturnTaskId:string|null`; reset on project change, not on polling/theme changes.
- Add `openDocumentFolder(taskId = null, docId = null, returnTaskId = null) -> Promise<void>`: validate context, guard unsaved edits once, set scope/draft/baseline, then render.
- Extend `newDocument(taskId = state.docTaskId)`; sidebar plus explicitly passes `null`; node plus passes exact task ID. Reject task missing at submission without losing unrelated documents.
- Add `showDocumentStorage(taskId = state.docTaskId) -> Promise<void>`: fetch newest storage response on each click, show readonly path and copy button; handle clipboard rejection with selectable readonly text. Legacy absent folders show “此版本尚未生成节点目录；保存节点或创建文档后生成。”
- Folder dialog shows “保存后路径会更新；本地文件用于查看和备份，修改请在面板保存。” only in dialog, not persistent page chrome.

- [x] **Step 1: Write node-document browser flow.** Start separate server with `TASK_GRAPH_DATA` temporary directory and `PORT=0`, never reuse production data. Create nodes `a`, `b`; open `a`, create roadmap via its entry, edit/save using keyboard, verify scope and API owner, reload, switch to `b` (empty), open global folder (original documents), return to original task selection.
- [x] **Step 2: Write draft/context regressions.** Reject dirty folder switch and assert content + selector restore. Re-select same folder/document, toggle theme and edit/preview modes, wait through polling; assert draft unchanged. Independently update a shared document field and verify 409 plus existing changed-field confirmation before overwrite.
- [x] **Step 3: Write deletion regressions.** Delete owner remotely during dirty edit, refresh and save; assert document remains global with draft content. Remotely delete document too: rejecting restore creates nothing; accepting creates a new ID under still-existing owner or global fallback. Return after task deletion shows graph and one notification.
- [x] **Step 4: Run red browser tests.** `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 npx playwright test node-documents.spec.mjs`; expect missing UI controls/ownership flow failures.
- [x] **Step 5: Implement context and render delegation.** Import pure module, render current folder, handle node/file/reference entry with explicit scope and return node. Sidebar documents always opens global folder, while reselecting the already-open global view remains a no-op. Keep existing global references and provide open buttons; do not list all owned files as global checkboxes. Preserve existing referenced IDs even when not currently shown.
- [x] **Step 6: Implement safe saves/deletion.** Existing-document payload uses latest saved `taskId`, not stale draft owner. Missing document requires restore confirmation and a new UUID; owner validated against current tasks. After remote detach adjust current folder while preserving dirty draft. Delete-node confirmation mentions document retention; do not delete stored history. Selection cancel restores select value.
- [x] **Step 7: Implement new-document modal and path dialog.** Scope determined from call context, type chosen by user, template generated only on confirmed creation. Path retrieval does not call `discardGuard` or reset drafts. Render escaped readonly path; clipboard fallback and missing-directory guidance in dialog only.
- [x] **Step 8: Add style/mobile tests.** Node docs and folder toolbar use current compact surfaces and CSS theme variables. Test both themes at 1680×1050 and mobile 390×844; assert no horizontal overflow, editor save/return/path controls reachable, path dialog copy works or fallback text selectable. Capture screenshots with animations disabled.
- [x] **Step 9: Verify full regressions and record.** `npm test`, then `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 npm run test:browser`; all existing 12 browser tests and new tests pass. Adapt old selectors only if intentionally replaced, preserving their original behavioral assertions.

## Task 5: Agent/User Handoff and Live Verification

**Files:** Modify `README.md`, `AGENT_GUIDE.md`, `docs/progress.md`; generated previews in `docs/`.

**Interfaces:** Consume tested UI/API; no new functionality. Agent updates documents via versioned commands, not direct disk edits.

- [x] **Step 1: Update user instructions.** Describe project/global versus node folders, entry/return, purpose-specific new documents, readonly path view, changing version paths, no external editor sync and node deletion retention. State exact limits.
- [x] **Step 2: Update agent instructions.** Show `saveDocument` with `taskId`, both new types, safe old-client update behavior, `GET /storage` shape and revision handling. Explain reading global context plus node context and references; reject interpreting written plans as verified completion.
- [x] **Step 3: Run final suites.** `npm test` and `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 npm run test:browser`. Record actual counts, not estimated counts; investigate failures before claiming completion.
- [x] **Step 4: Perform read-only live smoke check.** Before restart GET actual project IDs/revisions/counts; gracefully stop only our known server session and restart `npm start` so new routes/module load. GET all projects and compare latest snapshots, allowing user's concurrent updates. Check old three global documents still visible; use temporary-service screenshots for new document creation, never create demo node documents in real projects without user request.
- [x] **Step 5: Final review and delivery.** Use chosen execution workflow's review mechanism; close any reproduced important findings and rerun affected tests. Link app and new screenshots; explain clicks to use the feature, actual folder naming, no live-data mutation and any remaining limitations. No Git commit unless user separately initializes/authorizes repository workflow.

## Plan Self-Review and Handoff

Coverage: ownership/limits/delete retention Task 1; physical paths/atomicity/export Task 2; minimal scoped UI/templates Task 3; navigation/dirty conflicts/deletions/themes/mobile Task 4; agent protocols/docs/regression/live safety Task 5. Each Review Focus has a specific test in its owning task; names and response fields match downstream consumers.

Execution approved by user “执行” using native implementation and one independent final review. All five tasks and review fixes are complete; final verification: 27 Node tests + 22 Chromium tests passed. Source, plan, spec and durable ledger remain in place because no Git repository exists.
