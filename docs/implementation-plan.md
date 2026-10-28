# Task Graph Implementation Plan

**Goal:** Deliver the approved local directed-graph task workspace for people and agents.
**Architecture:** Node.js HTTP service, versioned atomic file snapshots, vanilla HTML/CSS/JS graph client. A project snapshot is the shared API contract.
**Spec:** docs/design-proposal.md (approved in conversation).
**Execution:** Native, continuous implementation in this session.

## Global constraints

- Bind 127.0.0.1 by default; no external runtime dependencies.
- Acyclic dependencies; completed prerequisites and passed acceptance required for completion.
- User and agent updates share revision checks and server validation.
- Preserve Markdown documents and recovery history on disk.
- Clearly identify sample data; never represent it as actual execution results.

## Review focus

- Reopening a prerequisite must not silently invalidate a completed downstream task.
- Imported graph or document IDs must not create unsafe filesystem paths.
- Concurrent edits must conflict explicitly rather than overwrite.
- HTML in titles, evidence and Markdown must remain inert.
- Browser refresh and server restart must retain all accepted edits.

## Tasks

### 1. Domain rules
- [x] Write and run failing tests for cycle rejection, completion gates, readiness, invalid imports and downstream consistency.
- [x] Implement src/model.mjs: validateProject, applyCommand, getReadiness and layoutGraph.
- [x] Run node --test tests/model.test.mjs.

### 2. Store and API
- [x] Write and run failing tests for persistence, atomic snapshots, stale revisions, document mirrors and API errors.
- [x] Implement src/store.mjs and server.mjs with GET projects/snapshot, POST project/import/commands and export.
- [x] Run node --test tests/*.test.mjs.

### 3. Interactive workspace
- [x] Implement public/index.html, styles.css, app.js and shared safe Markdown rendering.
- [x] Add graph pan/zoom, node selection/drag, connection form, search/filter, inspector, acceptance editor, documents, activity, import/export and projects.
- [x] Exercise actual browser flows, including hostile text and narrow screens.

### 4. Delivery
- [x] Add README and AGENT_GUIDE with concrete API commands and recovery guidance.
- [x] Review implementation independently; resolve material findings with regression tests.
- [x] Run full test suite and browser verification, start local service, provide URL and evidence.
