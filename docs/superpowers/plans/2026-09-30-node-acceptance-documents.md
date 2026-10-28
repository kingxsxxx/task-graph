# Node Acceptance Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将验收文档独立为节点专属资料，使每条验收标准只关联本节点验收文档，并安全兼容旧关联。

**Architecture:** 新增 `project.acceptanceDocuments`，以不可变 taskId 归属和独立命令隔离普通文档。两个集合共用项目 revision、版本快照和 HEAD 原子提交；前端复用 Markdown 编辑控件，验收渲染独立为小模块。旧普通引用仅显式复制转换，删除节点的验收资料独立归档。

**Tech Stack:** Node.js >=22、ES modules、原生 HTML/CSS/JavaScript、node:test、Playwright Chromium；不新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-09-30-node-acceptance-documents-design.md`，用户已回复“确认”批准。

## Global Constraints

- 项目新增可选数组 `acceptanceDocuments`，旧项目缺失时等价于空数组。
- 每条验收标准可以关联零份或一份本节点验收文档。
- 普通文档和验收文档合计最多 1000 份，包括归档验收文档。
- 单份正文 500000 字符、标题 160 字符、完整 JSON 7 MB、请求 8 MB 的限制保持不变。
- 普通文档与验收文档 ID 不重叠；新验收文档使用 acceptance- 前缀。
- 验收文档不参与普通“关联文档”的多选列表，也不混入普通节点文件夹。
- 读取旧快照、刷新、查询路径和启动服务均不改写项目，不自动复制文档，不提升 revision。
- 旧普通文档不搬动、不删除；旧验收关联通过明确的复制操作转换，保留原件。
- 所有文档文件与 snapshot.json 写完后才切换 HEAD；历史版本和原件不重写、不清理。
- 删除节点时，其验收文档单独归档，不变成普通项目文档，不级联删除正文。
- 验收文档存在不等于验收通过；前置、通过结果和非空证据要求不变。
- 测试只使用临时目录；不自动转换或试写用户真实项目。使用 apply_patch 编辑文件。
- 当前目录不是 Git 仓库；不初始化仓库，不伪称 commit，各任务完成后更新执行记录。

## Review Focus

- 旧客户端整体更新验收数组：既有旧引用可保留，但新增/更换普通文档引用必须拒绝。（Task 1）
- 多个验收项共用文档且另一个窗口删除正文：所有失效引用清理，本地证据草稿仍可保存。（Task 4）
- 用户准备转换时原验收项、原文档或 revision 已变化：操作明确失败，无副本残留，不改变原件。（Tasks 1、2、4）
- 节点与正文被先后远端删除：不恢复成普通文档或挂到别的节点，草稿仍可复制。（Task 4）
- 删除后新建同名甚至同 ID 节点：归档不复活，不出现在新节点选择器中。（Tasks 1、3、4）

## Files and Responsibilities

- Modify `src/model.mjs`：集合/归属/旧引用校验，验收命令、转换与归档。
- Modify `src/store.mjs`：独立文件、目录与同一 HEAD 的路径响应。
- Modify `src/http.mjs`：白名单提供 `/acceptance.js`；复用既有命令路由。
- Create `public/acceptance.js`：纯验收范围过滤、模板、节点区域、验收项与验收编辑页渲染。
- Modify `public/documents.js`：移出验收项渲染，保留普通文档职责。
- Modify `public/app.js`：集合上下文、关联/新建/转换、草稿与冲突、归档只读和路径选择。
- Modify `public/refinement.css`：紧凑控件、模式入口、归档只读布局、两种主题和手机适配。
- Create `tests/acceptance-documents.test.mjs`、`tests/acceptance-storage.test.mjs`、`tests/acceptance-documents.spec.mjs`。
- Modify `tests/document-links.test.mjs`、`tests/document-links.spec.mjs`：替换已被新设计废止的“任意普通文档作验收引用”预期；保留普通多选和按需文档测试。
- Modify `README.md`、`AGENT_GUIDE.md`、`docs/progress.md`；create `docs/acceptance-documents-ledger.md` 用于实际执行记录。

## Task 1: Domain Rules, Dedicated Commands and Legacy Conversion

**Files:** `src/model.mjs`, `tests/acceptance-documents.test.mjs`, `tests/document-links.test.mjs`。

**Interfaces:**
- Consumes `validateProject(project)`、`applyCommand(project, command)`、`AppError`、`makeId(prefix)`。
- Produces optional `acceptanceDocuments: Array<{id,taskId,title,content,archived:boolean,updatedAt?,archivedTaskTitle?:string}>`；归档时 archivedTaskTitle 固定为删除时节点名。
- Commands: `{type:'saveAcceptanceDocument',document:{id?,taskId?,title,content},criterionId?}`；`{type:'deleteAcceptanceDocument',id}`；`{type:'convertAcceptanceDocument',taskId,criterionId,documentId,title?}`。
- Criteria: `acceptanceDocumentId?:string|null`；兼容 `documentId`，两者不得同时非空。存量旧引用仅能原样保留或清空。

- [x] **Step 1: 写失败测试。** 使用两个 backlog 节点 a、b 和普通文档 g 的合法 fixture `p`。新增 `saveAcceptanceDocument` 创建 proof-a，关联已有 check-a；断言本节点可引用，其他节点、普通 ID、归档 ID、非法值均拒绝。每个命令使用真实 applyCommand，不 mock。

```js
const next = applyCommand(p, {type:'saveAcceptanceDocument', document:{id:'acceptance-a',taskId:'a',title:'验收',content:'# 证据'},criterionId:'check-a'});
assert.equal(next.tasks[0].criteria[0].acceptanceDocumentId,'acceptance-a');
assert.deepEqual(next.documents,p.documents);
assert.throws(()=>applyCommand(next,{type:'updateTask',id:'b',patch:{criteria:[{...p.tasks[1].criteria[0],acceptanceDocumentId:'acceptance-a'}]}}));
```

- [x] **Step 2: 运行 RED。** `node --test tests/acceptance-documents.test.mjs`；预期未知命令或缺失新归属校验导致失败，不得是 fixture 本身非法。
- [x] **Step 3: 实现校验与命令。** 在 model 内扩展既有函数，不建立第二套事务。更新验收文档时省略 taskId 保留归属，显式改变拒绝；拒绝编辑归档正文；普通命令不能更新验收集合。deleteAcceptanceDocument 清空所有对应新引用；deleteTask 归档其验收正文，普通节点文档继续原规则。
- [x] **Step 4: 补旧引用、原子转换与容量失败测试，并各自观察 RED→GREEN。** 旧快照可 validate/import；updateTask 用验收项 ID 与原项比较，只准原样保留/清空旧 documentId，新建任务禁止新增旧引用。转换复制原普通正文、清空旧字段并设置新引用；失败不改输入。覆盖原文已删、验收项已删、原引用不匹配、两个集合 ID 碰撞、1000/1001 合计上限、500000/500001 正文上限、7 MB 限制，关联仍不能代替通过和证据。

```js
const converted = applyCommand(legacy,{type:'convertAcceptanceDocument',taskId:'a',criterionId:'check-a',documentId:'g'});
assert.equal(converted.acceptanceDocuments[0].content,'# 原件');
assert.deepEqual(converted.documents,legacy.documents);
assert.equal(converted.tasks[0].criteria[0].documentId,null);
assert.equal(applyCommand(converted,{type:'deleteTask',id:'a'}).acceptanceDocuments[0].archived,true);
```

- [x] **Step 5: 调整旧测试并验证。** 将新建旧引用的测试改为 legacy fixture 读取/合法保留场景；保留普通关联行为。`npm test` 全部通过后，在 ledger 记录实际结果；本环境不 commit。

## Task 2: Atomic Files, Path API and Reload Compatibility

**Files:** `src/store.mjs`, `tests/acceptance-storage.test.mjs`。

**Interfaces:**
- Consumes Task 1 的集合与命令；复用 `Store.readCommitted(id)`、`Store.command(id,revision,command)`、`Store.writeArtifacts(destination,project)`。
- Produces storage 附加字段：`acceptanceFolders:{tasks:[{taskId,path,exists}],archived:[{taskId,title,path,exists}]}`；`acceptanceDocuments:[{documentId,taskId,archived,path}]`。既有 `projectFolder/tasks/documents` 字段保持不变。

- [x] **Step 1: 写失败存储测试。** mkdtemp 创建 Store 和节点，写普通及验收文档，查询 storage 后读取真实文件。

```js
assert.ok(paths.acceptanceDocuments[0].path.endsWith('/tasks/a/acceptance/acceptance-a.md'));
assert.equal(await readFile(paths.acceptanceDocuments[0].path,'utf8'),'# 验收正文');
assert.equal((await new Store(directory).get(p.id)).acceptanceDocuments[0].taskId,'a');
```

- [x] **Step 2: 运行 RED。** `node --test tests/acceptance-storage.test.mjs`；预期缺少路径字段或真实文件。
- [x] **Step 3: 实现路径与写入。** 为所有当前节点生成 acceptance 空目录；活跃文件写 tasks/<id>/acceptance，归档写 archived-tasks/<id>/acceptance。storage 只用一次 readCommitted 的结果；旧目录返回 exists=false，不写文件。归档目录按 owner ID 去重。
- [x] **Step 4: 补一致性/失败测试并运行 RED→GREEN。** 覆盖 legacy 快照读取后 HEAD 和快照哈希不变；查询期间新提交不能混版；注入 writeArtifacts 失败使转换不切换 HEAD；过期 revision 409 不产生副本；删除节点后归档路径存在；导入新旧 JSON 并用新 Store 重读；更新原件与副本互不影响。
- [x] **Step 5: 验证并记录。** `npm test` 全部通过；ledger 记录真实结果，不操作实际 data 目录。

## Task 3: Pure Acceptance Views and Strict List Separation

**Files:** create `public/acceptance.js`; modify `public/documents.js`, `src/http.mjs`, `public/refinement.css`, `tests/acceptance-documents.test.mjs`。

**Interfaces:**
- `scopeAcceptanceDocuments(project,taskId,{archived=false}={}) -> AcceptanceDocument[]`，未提供 taskId 仅在归档模式用于全部归档；活跃列表必须有具体节点。
- `acceptanceTemplate(title) -> string`，包含目标、步骤、预期/实际结果、证据与结论。
- `renderAcceptanceCriteria(project,taskId,criteria) -> HTML`，从 ordinary documents 模块移入；只列本节点未归档文档。
- `renderNodeAcceptanceDocuments(project,taskId) -> HTML`。
- `renderAcceptanceView({project,taskId,draft,mode,archived=false}) -> HTML`，复用现有编辑控件 ID；归档仅正文预览、复制、删除，不提供保存或创建。
- DOM: `data-acceptance-folder`, `data-acceptance-new`, `data-open-acceptance`, `data-convert-acceptance`；验收选择器 `data-criterion-field="acceptanceDocumentId"`；保留每项可访问标签。

- [x] **Step 1: 写失败渲染测试。** 以 a、b、项目普通文档、a 的两份验收文档、归档文档构建 fixture；断言 a 的选择器不含其他集合/节点 ID，普通 picker 不含验收 ID；HTML 中危险标题与正文被转义；归档没有可编辑正文/保存入口；legacy 标记原文和转换入口而非正常候选项。
- [x] **Step 2: 运行 RED。** `node --test tests/acceptance-documents.test.mjs`；预期缺少新模块或过滤行为。
- [x] **Step 3: 实现纯模块与静态白名单。** 原生选择器、“不关联”项、紧凑新建/打开按钮；普通编辑保持原行为。编辑页提供 `#documentCollection`，值 ordinary、acceptance、acceptance-archive；验收视图注明节点和类别，归档视图按 archivedTaskTitle 展示来源。CSS 复用现有颜色变量，不引入组件依赖。
- [x] **Step 4: 验证。** `npm test`；新增 `/acceptance.js` HTTP 返回 200，而任意源码路径仍 404；记录 ledger。临时允许尚未接入的浏览器测试保持原页面，Task 4 统一替换编排。

## Task 4: Browser Workflow, Conversion and Draft Safety

**Files:** `public/app.js`, `public/refinement.css`, create `tests/acceptance-documents.spec.mjs`, modify `tests/document-links.spec.mjs`。

**Interfaces:**
- Consumes Tasks 1–3 接口。扩展 state：`docCollection:'ordinary'|'acceptance'|'acceptance-archive'`。
- `openAcceptanceFolder(taskId,docId=null,returnTaskId=null,{archived=false}={}) -> Promise<void>`。
- `newAcceptanceDocument(taskId,criterionId=null) -> Promise<void>`；`convertAcceptanceDocument(taskId,criterionId,documentId) -> Promise<void>`；沿用 perform/api/command 错误入口。
- 同名 collection 内只按 ID 选择，draft、baseline、删除恢复和路径弹窗均按当前集合分派。普通项目入口显式切回 ordinary。

- [x] **Step 1: 写并运行主流程失败测试。** 独立临时服务：a、b 各有标准；a 创建并关联正文，返回原节点，刷新仍关联；b 不能选择 a 的正文；普通勾选列表无验收正文；更换/解除引用不删除文件。

```js
await page.getByLabel('第 1 项验收文档',{exact:true}).selectOption('acceptance-a');
await page.locator('[data-action="save"]').click();
expect((await snapshot(page)).tasks[0].criteria[0].acceptanceDocumentId).toBe('acceptance-a');
```

Run: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 npm run test:browser -- tests/acceptance-documents.spec.mjs`；预期入口或隔离缺失导致失败。

- [x] **Step 2: 接入上下文与创建/关联。** 打开、返回、保存和快捷键按 docCollection 分派。新建可选模板；criterionId 创建前，未保存节点修改须确认保存；必须确认保存实际成功且目标项存在，不能在保存取消后继续。新建及关联由一次专用命令提交。
- [x] **Step 3: 写并运行旧关联转换测试。** 使用 API import 导入真实 legacy fixture（不能用新 createTask 建旧引用）；显式点击转换后原件哈希不变，新正文在验收目录，旧字段清空。取消转换保留节点/文档草稿；转换期间 remote revision 变更返回冲突，无副本残留。实现转换确认和对应新文档选择。
- [x] **Step 4: 写并运行并发草稿测试。** 验收选择后本地证据变脏，远端删除正文再刷新：草稿与基线只清理失效新引用，文本保留可保存；两个标准共享同一正文，全部清空。正文编辑中的 409、重复选择、主题、预览切换、取消新建保留内容和光标。依次删除节点与正文时保留可复制草稿，不写 ordinary 或其他节点。每个复现先确认 RED，再实施对应保护。
- [x] **Step 5: 写并运行归档与设备测试。** 删除节点归档可发现/预览/复制/明确删除，普通项目文档不混入验收；同名或同 ID 新节点不能选归档正文。覆盖深浅主题、390px 手机无横向溢出、普通 picker 默认收起、键盘访问。截图等待手机侧栏动画结束，不把过渡态当最终画面。
- [x] **Step 6: 调整旧浏览器预期并完整验证。** 普通文档空白/模板与多选共享测试保留；旧任意普通验收关联测试改为 legacy 转换与本节点专属关联，删除关联草稿回归继续覆盖。运行 `npm test` 与完整 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 npm run test:browser`，不得只报新文件通过。更新 ledger。

## Task 5: Documentation, Independent Review and Live Handoff

**Files:** `README.md`, `AGENT_GUIDE.md`, `docs/progress.md`, `docs/acceptance-documents-ledger.md`。

**Interfaces:** 完整用户入口与专用命令样例；交付前须维持实际项目数据和 revision 不变，不替用户执行转换。

- [x] **Step 1: 更新用户与代理说明。** 两种文档集合、三个命令、新字段、归属限制、合计上限、旧引用转换、归档只读、版本文件不会外部同步、备份向旧应用不保证兼容。删除旧文档可作验收引用的过时指导。
- [x] **Step 2: 请求一次独立只读代码审查。** 提供设计、计划、变更文件与测试结果，重点检查 Review Focus。无 Git 时说明不能做历史 diff，不让 reviewer 试写实际项目。Critical/Important 问题先复现，再按 TDD 修复；复查所有对应测试。
- [x] **Step 3: 最终验证。** `node --check public/app.js`、`node --check public/acceptance.js`、`npm test`、完整浏览器命令全部通过；明确记录实际数量、退出码和未解决问题，不预填成功。
- [x] **Step 4: 服务加载与只读冒烟。** 先核对旧服务 PID/cwd 和实际快照哈希，再正常结束旧进程并启动 npm start；不得删锁文件绕过活跃进程。启动后核对原有快照与 revision，浏览器只读验证两个列表隔离、入口、零 JS 错误。仅做 read-only GET/查看，不在真实项目创建演示验收文档。
- [x] **Step 5: 交付。** 更新设计/计划/ledger 实际完成状态；简洁说明刷新、节点新建和选择入口、旧引用需显式转换，以及测试结果。不要宣称自动转换已发生。

## Plan Self-Review and Handoff

- Spec sections 1–3 → Tasks 1、3；section 4 → Tasks 3、4；section 5 → Task 2；sections 6–7 → Tasks 1、2、4；section 8 → Tasks 1–5。
- 五项 Review Focus 均已落实到具体失败测试步骤；复用的函数和状态名在 Interfaces 中一致。
- 执行复选框已完成；实际测试、审查修复与环境适配见 docs/acceptance-documents-ledger.md。真实项目未转换、未试写。
- 建议主代理在当前会话逐项实施，最后一次独立审查；这五项依赖连续，共享模型与文档上下文，逐项换实施代理收益较小。另一选项是每项使用独立实施代理和审查代理，隔离更强但上下文开销更大。
- 用户已选择直接实施；已按 inline 流程实施并完成一次独立审查及修复。
