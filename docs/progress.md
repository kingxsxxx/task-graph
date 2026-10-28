# Task Graph execution ledger

2026-09-30 — Consistent rounded dropdown popups:
- User explicitly requested direct completion without plan confirmation. Replaced app-owned native single-select popups with shared rounded listbox surface while retaining real form fields and existing handlers.
- Covers theme, status, criterion results/evidence document selectors, document scope/type/collection and modal choices; four palettes, 12px popup/9px trigger radius, shadow, inset options/checkmark, long-list scroll, viewport bounds and upward placement. App dialogs/reference picker rounding aligned; OS file picker and native safety confirmations unchanged.
- Eight real-browser regressions cover pointer/touch/keyboard, drafts, dynamic/modals, mobile palettes, literal malicious-looking labels, disabled/removed controls and attribute-only disable/hide/display/inert/dialog-close cleanup. Independent reviewer lifecycle finding reproduced RED and fixed GREEN.
- Final npm test 44/44, full Chromium 56/56 and JS syntax checks passed. Live readonly screenshot inspected: rounded popup, zero JS errors, new asset 200. All project snapshot hashes/revisions unchanged after safe service restart; no production writes.
- Details: docs/dropdown-refinement-ledger.md. Firefox/Safari and actual screen-reader announcement certification not claimed.

2026-09-30 — Stage creation moved into graph toolbar:
- User approved bounded layout change: remove stage creation from project header; group “新建阶段 / 连接 / 整理” in graph toolbar, matching 30px height, creation retains primary color. Import/export remain in header.
- Existing IDs and creation handler retained; graph action group stays together at desktop/mobile widths, mobile uses labelled icon buttons with search on a separate row. No model/data changes.
- New browser regression observed RED while creation was in header, then GREEN; checks button location/order/equal height, all four palettes at 1680/800/390px, no horizontal overflow, and creation dialog opening/cancellation.
- Final npm test 44/44 and full Chromium suite 48/48 passed. Readonly live check showed two header buttons, correct graph action order and zero JavaScript errors; desktop/mobile screenshots inspected. No production project writes or service restart.

2026-09-30 — Two additional user palettes delivered:
- Retained classic dark/light; added mint light (white/mint/deep purple) and ocean teal dark (deep navy/teal/red alert accents), using supplied base swatches and confirmed bg-300 values.
- Topbar native four-option selector remembers choice before CSS loads; unknown stored values fall back safely. Presentation-only changes preserve task/document drafts and existing layout.
- New palettes cover graph, sidebar, documents, archive, forms, dialogs, activity and high-contrast status legend. Independent review's minor minimap contrast gap was reproduced RED then corrected GREEN using semantic SVG colors.
- Final npm test 44/44, full Chromium 47/47 and JS syntax checks passed. Mobile 390px no horizontal overflow, four-palette legend text contrast >=4.5 and new-palette minimap node contrast >=3 verified. Readonly live check zero JS errors, unchanged project hashes/revisions; no production data writes or restart needed.
- Details: docs/palette-refinement-ledger.md; README updated. No remaining review findings.

2026-09-30 — Node-independent acceptance documents delivered:
- Separate acceptanceDocuments and same-node optional criterion.acceptanceDocumentId; ordinary references unchanged. Explicit legacy copy conversion preserves originals.
- Dedicated tasks/<taskId>/acceptance and archived-tasks/<taskId>/acceptance Markdown folders, shared atomic HEAD, readonly archive and independent UI collection.
- Dirty drafts survive remote deletion and real HTTP 409. Independent review found same-ID owner recreation could inherit old drafts; reproduced RED, fixed with immutable node instanceId and local identity checks, then GREEN. No remaining Critical/Important findings.
- Native Chinese font priority, stronger node text, 11px status labels and 7px dots, higher contrast dark/light colors. Native Windows/macOS rasterization remains device-dependent.
- Final verification: npm test 44/44; complete Chromium suite 43/43; JS syntax checks passed. Live readonly smoke returned acceptance.js 200, blocked source 404 and zero JS errors. Three project SHA-256 hashes/revisions unchanged across restart; no real-data migration or demo writes.
- Plan/spec and detailed evidence: docs/acceptance-documents-ledger.md. No Git repository initialized, committed, pushed or cleaned up.

Plan: docs/implementation-plan.md
Design approved by user: 可以.

The parent directory is not an initialized Git repository. Work is isolated in the new task-graph directory; no existing application files are modified.
Execution uses the approved design and continues without requesting repeated authorization for routine implementation.
Task 1: complete — domain tests cover graph constraints, acceptance gates, downstream consistency and 40 generated DAG layouts.
Task 2: complete — file-store and real HTTP API tests cover persistence, Markdown snapshots, serialized revision conflicts and rejected input.
Task 3: complete — actual Chromium tests cover desktop/mobile, pan/zoom/drag, filtering, stage/dependency creation, acceptance, Markdown, persistence and JSON roundtrip.
Task 4: complete — README and AGENT_GUIDE delivered; final npm test 16/16 and Chromium browser tests 8/8 passed; live service http://127.0.0.1:4310 returned 200 with 8 sample tasks, 9 dependencies and 3 Markdown documents.

Independent review: review_task_graph (read-only) examined model, store, HTTP, server, Markdown and frontend. No Critical findings. Three Important draft/concurrency findings were reproduced in actual Chromium and fixed:

- Re-selecting the same task/document no longer resets the draft.
- Saving marks the workspace inert until acknowledgement, preventing editing or navigation races.
- Refresh reloads clean drafts; dirty drafts reconcile unchanged fields with the agent's latest values. Changed shared fields require explicit conflict confirmation, and updates send only changed task fields.

Additional regression: full project snapshots are capped at 7 MB so every accepted export fits the 8 MB import request limit.
Verification after fixes: npm test 16/16; Chromium browser tests 8/8.

Environment adaptation: this host is Ubuntu 20.04, unsupported by current Playwright. Browser verification uses its Ubuntu 22.04 fallback build through PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64. Application runtime itself has no external dependencies.
Native workspace adaptation: no initialized repository exists, so branch/worktree/commit helpers are inapplicable; source and delivery records remain in the isolated task-graph folder.
No deferred review findings remain. Power-loss fsync durability and full accessibility audit are not claimed; ordinary accepted writes, process restart and tested mobile interactions are verified.

2026-09-30 — Navigation and visual refinement requested by user:
- Reproduced unchanged polling replacing project buttons in Chromium. Sidebar now retains unchanged project list DOM, so polling does not interrupt focus or clicks.
- Converted the noninteractive “我的项目” caption into an accessible expandable button. Switching projects resets stale search/status filters, opens the graph and closes mobile navigation. Direct `?project=` links and reload selection are supported.
- Removed decorative slogans, fake profile, redundant document shortcuts and canvas hints. Replaced 126px statistic cards with a 50px desktop strip; kept acceptance warnings and unsaved-edit protection.
- Added persistent dark/light themes, applied before stylesheet loading. Light palette covers graph, task details, documents, activity, forms and dialogs.
- Existing 16 domain/API tests and all 12 Chromium tests passed; added four regressions for navigation, polling, compact statistics and persisted themes/mobile behavior. Tests use temporary data only. Live inspection verified the discovery project still has nine tasks and three documents; no production project data was written by this refinement.

2026-09-30 — Node-owned document folders delivered:
- Approved design and implementation plan in docs/superpowers/{specs,plans}; execution and review record in docs/node-folders-ledger.md.
- Optional document.taskId ownership, technical/verification types, 1000-document limit, legacy update compatibility and delete-node document retention.
- Per-node Markdown files in versioned tasks/<taskId>/documents directories; storage API derives paths and revision from one HEAD read, legacy folders reported absent without writes.
- Scoped document editor, node creation/folder entry, return-to-node, global reference opening and readonly/copyable local paths; supports dark/light and mobile.
- Fresh review found editor-cancel and refresh-selection regressions plus dirty-folder list-refresh gap. All three were reproduced and fixed in one pass, with explicit browser RED→GREEN and final suites green.
- Final verification: npm test 27/27 and real Chromium browser tests 22/22. Tests and feature screenshots use temporary project data. Live smoke check reported zero JavaScript errors; all actual project snapshots remained byte-equivalent as JSON before and after service restart.
- Runtime remains dependency-free. Direct external file edits do not sync automatically; no generic file browser, attachments, history cleanup or automatic task execution is claimed.

2026-09-30 — Small sidebar toggle refinement:
- User approved bounded in-chat design: persistent desktop hide/show button, full-width content, existing mobile navigation retained.
- Reused #menuToggle with accessible expanded/controlled state; hidden sidebar is inert. Desktop preference loads before CSS and persists in localStorage; mobile behavior ignores and does not overwrite it.
- Browser regression first failed because desktop toggle was hidden; implementation passed hide/show/reload, dirty document preservation, light theme and mobile-to-desktop resizing cases.
- Final npm test 27/27 and Chromium tests 24/24 passed. Read-only live smoke check: sidebar display none, content starts at x=0, visible restore button, no JavaScript errors. No project data writes.

2026-09-30 — On-demand document library and acceptance document links:
- User approved bounded design: arbitrary project documents with optional templates, collapsed scrollable node-reference checkboxes, and one optional document reference per acceptance criterion. Existing project and node documents retained.
- Added general/free-form document type with blank content by default; typed templates can be disabled when creating a document. No mandatory project document set and no automatic data migration.
- Replaced the expanded inspector document list with a native keyboard-accessible details picker and selected count. Same document can be independently referenced by multiple nodes; owned documents show their scope without changing ownership.
- Each criterion has an optional documentId and labelled selector, verification group first, plus open/return navigation. Deletion clears only corresponding references, preserving criterion content, result and evidence. Linking does not satisfy acceptance gates.
- RED→GREEN: initial model tests reproduced missing free-form support, invalid reference acceptance and deletion cleanup; browser tests reproduced forced templates, always-visible references and absent criterion controls.
- Independent read-only review found one P2 stale-draft issue after remote document deletion. Reproduced in Chromium, then pruned vanished links in draft and baseline only; local acceptance edits remain savable without spurious field conflicts. Added independent-criteria regression too. No other concrete findings.
- Final product verification: npm test 32/32 and full Chromium suite 31/31; JavaScript syntax checks passed. Browser tests use isolated temporary data. README and AGENT_GUIDE describe the new UI and optional fields.
- Live service restarted at http://127.0.0.1:4310; a previous unfinished browser connection briefly delayed shutdown, then the old process exited naturally. All three project snapshot SHA-256 hashes and revisions matched before/after. Read-only live browser smoke check showed collapsed picker, two acceptance selectors, zero JavaScript errors. No production project writes.
