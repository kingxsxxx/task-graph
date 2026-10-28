# SDD ledger — plan: docs/superpowers/plans/2026-09-30-node-document-folders.md

Execution: native, approved by user “执行”. Spec approved “符合”.
Ruling: No Git repository exists; use this durable ledger and source directory, not Git-only workspace/commit helpers. Keep ledger after delivery because no Git history can replace it — avoids creating unrequested repository state; cost: no commit-based rollback.
Pre-flight: Task 1 document.taskId consumed by Tasks 2–4; names/null normalization consistent.
Pre-flight: Task 2 storage response consumed by Task 4 path dialog; one-read HEAD and legacy exists flags consistent.
Pre-flight: Task 3 scope/render/template exports consumed by Task 4; editor IDs and action selectors preserved.
Pre-flight: Task 4 behavior documented by Task 5; no external editing sync promised.
Task 1: complete — five new tests observed RED then npm test 21/21 GREEN, including 40 generated DAG/ownership cases.
Task 2: complete — five storage tests RED→GREEN; npm test 26/26. Verified per-node folders, legacy absence, one-HEAD coherence, fault injection, import and delete retention.
Task 3: complete — render/filter/template test RED→GREEN; npm test 27/27. Pure renderer preserves editor contracts and escapes names.
Task 4: complete — first missing-node-entry browser test RED; scoped UI implemented; 27 Node tests and 17 full browser tests GREEN. Additional owned-field conflicts and simultaneous owner/document deletion cases added for existing concurrency behavior.
Task 4: test adaptation — inspector now has document-open buttons as well as document page; narrowed old selector to #documentsView without changing draft-preservation assertions.
Task 5: in progress — README and AGENT_GUIDE updated; fresh read-only reviewer review_node_folders dispatched per executing-plans. Live server restart and read-only smoke check underway.
Final review: no Critical findings; two Important editor/context findings reproduced (cancel-new disables editor; clean refresh/poll resets selected file). Reproducing both before one fix pass.
Final: Ruling: re-grade review's dirty-folder remote addition from Minor to Important — the approved design promises list refresh while editing, and absent agent-created files misrepresent the working folder. Include list refresh plus caret preservation in the one fix pass — cost if wrong: extra rerender/focus complexity, covered by browser regression.
Final: Ruling: declined-to-judge external-editor sync, arbitrary file browsing, history cleanup, multi-process directory access and automatic node execution remain outside the approved scope — current API-based editing, version history and single-server lock stay — cost: these capabilities are not supplied.
Final: fixed cancel-new editor invalidation — cancelling document creation leaves current editor writable/selected (including sidebar entry) RED→GREEN; suite 27 Node + 22 browser GREEN.
Final: fixed clean refresh/poll selection reset — clean second-document refresh and remote update RED→GREEN; retain selected draft identity and refresh clean content; suite 27 Node + 22 browser GREEN.
Final: fixed dirty folder remote-addition visibility — remote addition with dirty draft/focus/caret RED→GREEN; reconcile latest snapshot and restore editor focus/caret; suite 27 Node + 22 browser GREEN.
Deferred minors: none remain after re-grading the only Minor finding as an approved behavior gap.
Task 5: complete — docs/API guide and temporary-data previews delivered; independent review done and all actionable findings covered by failing-then-passing tests. Final npm test 27/27; Chromium 22/22. Live API, old global docs, node entry and readonly legacy path verified with zero JS errors; all three actual snapshots exactly equal pre-restart snapshots. Service running at http://127.0.0.1:4310. Git-only finishing integration menu is inapplicable; workspace and durable ledger retained per recorded adaptation.
