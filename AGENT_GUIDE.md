# Agent Guide：如何使用 Task Graph 推进长程任务

## 开始或恢复

服务默认地址 `http://127.0.0.1:4310`。先读取项目列表，再读取选定项目完整快照：

```bash
curl -s http://127.0.0.1:4310/api/projects
curl -s http://127.0.0.1:4310/api/projects/project-demo
```

快照包含 `revision`、`tasks`、`edges`、`documents` 和最近 `activity`。示例项目明确标注为演示，不能将其中完成状态当作真实工作成果。实际工作请创建新项目。

```bash
curl -s -X POST http://127.0.0.1:4310/api/projects \
  -H 'Content-Type: application/json' \
  --data '{"name":"实际项目","description":"需要完成的目标"}'
```

读取已有项目大纲、计划或其他相关文档后，查找前置任务全部完成的阶段。文档按需创建，不要求固定 Plan、Roadmap、Notes 三份。优先恢复已有进行中阶段，再开始已满足前置条件的待开始阶段。阻塞原因写在任务描述与适当的工作记录中。

## 写入协议

所有阶段、文档与依赖更新：

`POST /api/projects/<项目ID>/commands`

```json
{
  "revision": 1,
  "command": {
    "type": "createTask",
    "task": {
      "id": "task-core",
      "title": "实现核心能力",
      "owner": "AGENT",
      "description": "具体目标与范围",
      "criteria": [
        {"id":"check-core","text":"关键流程测试通过","result":"pending","evidence":""}
      ]
    }
  }
}
```

成功返回更新后的完整快照，下一次写入必须使用返回的 `revision`。不要假设版本号没有变化。

HTTP 409 表示其他窗口或代理已更新项目：重新 GET、对照新的内容重建操作，再提交新版本。不要盲目重试整个旧快照，否则可能覆盖用户意图。

HTTP 400 表示校验失败，如成环、前置未完成或验收未通过；响应 `error` 给出原因。失败不会改变已提交快照。

## 操作列表

| type | 其他字段 | 作用 |
|---|---|---|
| `createTask` | `task` | 新增阶段；ID 可省略，由服务生成 |
| `updateTask` | `id`, `patch` | 修改阶段 |
| `deleteTask` | `id` | 删除阶段及所有连接，谨慎使用 |
| `addEdge` | `from`, `to` | 建立前置 → 后续依赖 |
| `removeEdge` | `from`, `to` | 移除依赖 |
| `saveDocument` | `document` | 按文档 ID 新建或完整更新 |
| `deleteDocument` | `id` | 删除文档并解除任务关联，谨慎使用 |
| `autoLayout` | 无 | 重新整理节点位置 |
| `renameProject` | `name`, 可选 `description` | 更新项目信息 |

`updateTask.patch` 可含 `title`、`description`、`owner`、`status`、`criteria`、`documentIds`、`position`。数组字段整体替换，先读取现有数组，保留不相关内容再修改。

任务状态：`backlog` 待开始、`active` 进行中、`review` 待验收、`done` 已完成、`blocked` 阻塞。

验收结果：`pending` 未验收、`passed` 通过、`failed` 未通过。

每条 `criteria` 可包含 `acceptanceDocumentId`，只能引用 `project.acceptanceDocuments` 中本节点未归档的一份文档；缺失、`null` 或空字符串表示不关联。普通文档、其他节点或归档引用会被拒绝。修改整个验收数组时保留未修改项的新旧引用。

例如：`{"id":"check-core","text":"关键流程可复现","result":"pending","evidence":"","acceptanceDocumentId":"acceptance-core"}`。关联本身不是验收通过的证据。

旧 `documentId` 仅为兼容字段，已有引用可原样保留或清空，但新建或更换这种普通验收引用会被拒绝。导入旧快照可保留它；不要静默替用户转换。两种引用不能同时非空。

独立验收命令（继续提交当前 revision）：

```json
{"type":"saveAcceptanceDocument","document":{"id":"acceptance-core","taskId":"task-core","title":"核心验收","content":"# 验收\n"},"criterionId":"check-core"}
```

`criterionId` 可省略；仅用于新建时原子关联本节点现有验收项。更新正文时先读取完整内容，省略 taskId 保留归属，显式搬动拒绝；归档只读。`deleteAcceptanceDocument` 使用 id，清空对应新引用，保留标准、结果与证据。

用户明确确认转换后提交 `{"type":"convertAcceptanceDocument","taskId":"task-core","criterionId":"check-core","documentId":"original-doc"}`，可附 title。复制原件正文并替换该项旧引用，原件保留；版本或旧引用已变化则拒绝，不残留副本。

任务只有在前置全部 `done` 后才能进入 `active`、`review` 或 `done`。完成还要求至少一个验收项，所有验收项 `passed` 且 `evidence` 非空。证据应记录真实命令、输出摘要、产物路径或可验证结论；不要仅填写“完成”。

更新整个验收数组并完成：

```json
{
  "revision": 3,
  "command": {
    "type": "updateTask",
    "id": "task-core",
    "patch": {
      "status": "done",
      "criteria": [
        {"id":"check-core","text":"关键流程测试通过","result":"passed","evidence":"实际验证记录：命令、结果和产物路径"}
      ]
    }
  }
}
```

若已完成任务需要返工，先调整其已启动或完成的下游状态，再调整上游。服务拒绝破坏依赖或验收一致性的更新。

## 文档和交接记录

文档 `type` 支持 `general`（自由文档）、`plan`、`roadmap`、`technical`、`verification`、`notes`。内容与标题自由编写，服务不会强制创建模板。节点的 `documentIds` 可为空，也可引用同一项目的多份文档；同一文档可被多个节点引用，不需要复制内容。

```json
{
  "revision": 4,
  "command": {
    "type": "saveDocument",
    "document": {
      "id": "doc-handoff",
      "title": "恢复记录",
      "type": "notes",
      "content": "# 恢复记录\n\n## 当前阶段\n任务 ID\n\n## 已完成\n实际工作\n\n## 验证\n命令与结果\n\n## 阻塞\n原因与所需输入\n\n## 下一步\n具体行动\n"
    }
  }
}
```

普通文档类型为 `general`、`plan`、`roadmap`、`notes`、`technical` 或 `verification`；普通 verification 笔记不自动成为独立验收文档。ID 仅允许字母、数字、短横线、下划线，最长 96 字符。两个集合 ID 不得重叠。`saveDocument` 是完整文档替换，因此更新前必须读取已有内容。

### 节点归属与真实文件

`document.taskId` 缺失或 `null` 表示项目级文档；新建时传节点 ID，即生成其专属目录中的文件。例如：

```json
{"revision":5,"command":{"type":"saveDocument","document":{"id":"doc-core-tech","taskId":"task-core","title":"核心实现细节","type":"technical","content":"# 实现细节\n\n## 方案\n根据实际工作填写\n"}}}
```

更新文档时不传 `taskId` 会保留现有归属；显式传其他归属会被拒绝，普通保存不能移动文档。节点自有文档不必再次加入 `documentIds`；该数组用于引用文档。开始节点工作前，读取相关项目级文档、其专属文档、已关联引用和各验收项的文档，避免只读局部方案。按真实工作维护路线、实现、验证和交接，不自动为所有节点生成空记录。

只读 `GET /api/projects/<项目ID>/storage` 返回：

```text
{projectId,revision,generation,projectFolder:{path,exists},
 tasks:[{taskId,path,exists}],documents:[{documentId,taskId,path}]}
```

节点路径为 `data/projects/<项目ID>/revisions/<版本目录>/tasks/<节点ID>/documents/`。响应路径为绝对路径，同一次读取的快照与路径使用同一版本。老版本节点目录可能 `exists:false`，仅查询不进行迁移；后续成功保存会生成目录。路径随保存版本变化，导入项目重新计算路径，不沿用源项目路径。

通过 API 保存，由服务写出真实 Markdown；不要直接改 `HEAD`、快照或版本目录文件，外部文件修改没有自动双向同步。删除节点会把其普通专属文档转为全局文档，内容和其他节点引用保留。草稿若需恢复被删文档，先向用户确认，再用新 ID 和当前合法归属创建；不能直接复活原文件。

独立验收路径元数据另有 `acceptanceFolders:{tasks:[{taskId,path,exists}],archived:[{taskId,title,path,exists}]}` 和 `acceptanceDocuments:[{documentId,taskId,archived,path}]`。活跃文件位于 tasks/<taskId>/acceptance，归档位于 archived-tasks/<taskId>/acceptance。删除节点只归档其验收文档，记录 archivedTaskTitle，不搬到普通集合；归档仅可读取或明确删除。原节点已删除的验收草稿不能挂到其他节点。

新建节点由服务生成不可修改的 `instanceId`，用于区分删除后同 ID 重建的节点。旧节点缺失此字段时仍可读取，不自动迁移；客户端验收草稿绑定打开时的节点身份，身份改变时仅保留供复制。

普通与独立验收/归档文档合计上限 1000，单正文 500000 字符，完整 JSON 7 MB、请求 8 MB。新格式备份不保证兼容旧版应用。

## 导出与恢复

- `GET /api/projects/<项目ID>/export`：下载完整 JSON。
- `POST /api/import`：请求体为完整快照，校验后创建新项目。
- 旧版 `snapshot.json` 可以通过导入恢复为独立项目。
- 单项目最多 250 阶段、2000 依赖、1000 文档；单文档最多 500000 字符，单节点引用最多 100 份文档；完整 JSON 备份最大 7 MB，请求最大 8 MB。

工作台只记录工作与证据，不会自动执行节点文字或文档命令。让看板持续反映真实进展；每次暂停前更新 Notes，便于用户或下一个代理继续。
