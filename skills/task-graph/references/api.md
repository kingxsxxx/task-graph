# Task Graph API and CLI

For the existing local Task Graph application, not a generic tracker. Node.js 22+ and a running local service are required. Default URL: `http://127.0.0.1:4310`. No external account or OpenAI API key is needed. This client intentionally permits only localhost/127.0.0.1 HTTP origins; it does not add remote hosting or authentication.

## CLI

Resolve the script from the installed skill directory. Run it through `node`; do not rely on executable permission or current working directory. All successful data is JSON on stdout except `--help`. Use `--file` for JSON commands to avoid shell interpolation of Markdown, backticks, dollar signs, or Chinese text. Create/edit input files with the environment's normal file-edit tool, not an interpolated shell string.

| Action | Arguments | Result |
| --- | --- | --- |
| `list` | none | Project IDs, names, revisions and counts |
| `get` | project ID | Complete snapshot, documents and activity |
| `ready` | project ID | Active / eligible backlog / review / blocked groups |
| `storage` | project ID | Read-only paths of generated Markdown |
| `export` | project ID | Full JSON snapshot on stdout |
| `create` | `--name NAME`, optional `--description TEXT` | New project; retain returned ID |
| `command` | project ID, `--revision N --file FILE` (or `-` for stdin) | Updated full snapshot |

Use `TASK_GRAPH_URL` or `--url` for a different local port. `TASK_GRAPH_TIMEOUT_MS` defaults to 10000. Exit codes: 0 success, 1 API error, 2 invalid input, 3 revision conflict, 4 unavailable/uncertain response. Errors are JSON on stderr. No retry or automatic revision update is performed. The destructive flag is not user authorization.

For example, create a command file containing:

```json
{
  "type": "createTask",
  "task": {
    "id": "tutorial-quality",
    "title": "验证教程质量",
    "owner": "AGENT",
    "description": "验证细节覆盖与可读性；人工确认仍需用户验收。",
    "criteria": [
      {"id":"coverage","text":"样例视频关键步骤可追溯","result":"pending","evidence":""},
      {"id":"readability","text":"用户确认样例教程易于理解","result":"pending","evidence":""}
    ]
  }
}
```

Then `node <skill-directory>/scripts/task-graph.mjs command <project-id> --revision <revision-actually-read> --file <command-file>`. The CLI supplies the HTTP envelope; the input file must contain the command only. After each success use the returned revision for the next operation. A delayed write requires rereading/reconciliation, not assuming the old version still applies.

## HTTP protocol

- GET `/api/projects`: list. GET `/api/projects/<id>`: full snapshot.
- POST `/api/projects`: `{name,description}` creates a project (revision 1).
- POST `/api/projects/<id>/commands`: `{revision,command}` applies one command.
- GET `/api/projects/<id>/storage`: generated paths; GET `/api/projects/<id>/export`: backup JSON.
- POST `/api/import`: validated full snapshot creates a separate project. Not included in the helper's mutation surface; import only when explicitly requested.

Snapshots contain `id`, `revision`, `tasks`, `edges`, `documents`, `acceptanceDocuments`, `activity`. List summaries are not full snapshots. IDs: 1–96 ASCII letters, digits, hyphens, underscores.

409: no command committed; reread and preserve intervening edits before a new write. 400: validation failed; inspect `error`, fix input. Network failure or incomplete/non-JSON response during POST: outcome unknown, not proof of rejection. Reconcile state using explicit IDs and content; an identical entity means no duplicate create. There is no idempotency-key guarantee. If still uncertain, stop and explain. Do not silently auto-retry.

## Commands

| type | Fields | Notes |
| --- | --- | --- |
| `createTask` | `task` | `id` optional; explicit stable ID helps reconciliation |
| `updateTask` | `id`, `patch` | Arrays in patch replace complete arrays |
| `deleteTask` | `id` | Destructive; ordinary owned docs become project docs; acceptance docs archive |
| `addEdge` / `removeEdge` | `from`, `to` | Prerequisite → dependent; no cycles |
| `saveDocument` | `document` | Create or replace complete ordinary document |
| `deleteDocument` | `id` | Destructive; clears ordinary references |
| `saveAcceptanceDocument` | `document`, optional `criterionId` | Separate node-owned acceptance collection |
| `deleteAcceptanceDocument` | `id` | Destructive; clears link, retains criterion/result/evidence |
| `convertAcceptanceDocument` | `taskId`, `criterionId`, `documentId`, optional `title` | Explicit legacy conversion, copy original; never silently migrate |
| `autoLayout` | none | Changes node positions; do not rearrange during unrelated edits |
| `renameProject` | `name`, optional `description` | Preserve existing scope |

Helper requires `--confirm-destructive` for deletion and conversion. `removeEdge` still needs task-scope authorization even though the flag is not required.

## Tasks and acceptance

Task patch supports `title`, `description`, `owner`, `status`, `criteria`, `documentIds`, `position`. Read the full existing task before replacing criteria or links; preserve unmodified members and fields.

States: `backlog`待开始, `active`进行中, `review`待验收, `done`已完成, `blocked`阻塞. Entering active/review/done requires every predecessor done. Done also requires at least one criterion and all criteria `passed` with nonempty `evidence`. The server checks presence, not factual truth; the agent must verify truth. If reopening a completed predecessor, reconcile started downstream nodes first instead of bypassing validation.

Each criterion: `{id,text,result,evidence,acceptanceDocumentId?}`; result is `pending`, `passed`, or `failed`. Keep user-approval criteria pending until the actual approval. Evidence should include command/result/artifact or the user's actual confirmation, not merely “completed.”

## Ordinary and acceptance documents

Ordinary document: `{id,title,type,content,taskId?}`. Types: `general`, `plan`, `roadmap`, `technical`, `verification`, `notes`. Omitted/null taskId on creation means project-wide; a task ID means node-owned. On update omission retains ownership; explicit reassignment is rejected. Saving replaces the document content: preserve unrelated content yourself. Node-owned docs do not need an extra `documentIds` link; that task array references additional same-project documents, including shared project outlines. No mandatory document trio.

Independent acceptance example:

```json
{"type":"saveAcceptanceDocument","document":{"id":"accept-quality","taskId":"tutorial-quality","title":"质量验收","content":"# 质量验收\n实际证据与待确认项"},"criterionId":"coverage"}
```

`criterionId` is optional and associates a newly created acceptance document with an existing criterion atomically. On updates, omit taskId to retain ownership. Link field `acceptanceDocumentId` can reference only an active acceptance doc owned by that exact node. Ordinary `verification` notes are not acceptance documents. Legacy `documentId` references can remain unchanged or be cleared, but new/replacement legacy references are rejected. Never silently convert them; the two link fields cannot both be nonempty. Archived acceptance docs are read-only except explicit deletion; don't attach deleted-node drafts to a new node, even with the same ID. Task `instanceId` distinguishes replacement nodes.

API saves generate actual Markdown files in versioned storage. Paths change across revisions. Ordinary node files live under `tasks/<id>/documents/`, acceptance under `tasks/<id>/acceptance/`, archived acceptance under `archived-tasks/<id>/acceptance/`. Read paths through `storage`; direct file edits do not synchronize back. Do not edit HEAD, snapshots, or versioned files.

Limits: 250 tasks, 2000 edges, 1000 combined documents, 100 ordinary references per node, 500000 characters per document, 7 MB JSON backup and 8 MB HTTP request. Do not bulk-create blank documents or attach binary artifacts as giant text.
