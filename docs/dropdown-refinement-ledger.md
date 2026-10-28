# Rounded dropdown refinement

User requested all similar square popup selectors improved until complete, explicitly waiving plan confirmation. Scope: app-owned single-select fields and existing app dialog/reference-picker rounding; browser file picker and native safety confirmations remain system-owned.

Implemented a shared rounded popup/listbox over real native selects, retaining form values and existing input/change handlers. Dynamic selectors in inspector, criteria, documents and modal dialogs are automatically enhanced. Four palettes, 12px popup radius, 9px trigger radius, inset option highlights/checkmarks, shadow, safe text rendering, max-height scroll and viewport-aware upward placement.

TDD: browser test RED because themed popup absent; new real Chromium tests cover theme persistence, drafts/keyboard, all dynamic field groups/modal, four palettes at 390px, long list and literal HTML titles, real touch context, disabled choices, upward placement and removed anchors. Initial selection defects traced to generated checkmark changing accessible name and popup rows stealing focus; explicit option labels and pointer/focus handling corrected, five initial tests GREEN.

Independent read-only dropdown_review found one Important lifecycle defect: childList-only observer missed attribute-only disable/hide/style/inert/dialog-close. New test observed RED (popup remained after disabled=true); observe relevant attributes excluding own ARIA writes, guard unchanged class writes, and close orphaned surfaces. Eight focused tests GREEN; expanded final test covers all five transitions. No Critical findings.

Review limitations: Chromium tested; real screen-reader announcements and Firefox/Safari behavior not independently certified. Use native backing form fields and labelled listbox semantics without claiming full accessibility/browser audit.

Final verification: fresh npm test 44/44 and complete Chromium suite 56/56 passed with exit 0; JS syntax checks passed. Live service restarted for new static asset; dropdowns.js returns 200, visible popup radius 12px, four labelled options and zero JS errors. All three snapshot hashes/revisions (77/28/1) identical across restart. No production writes, migrations or Git initialization. Important review finding resolved by RED→GREEN lifecycle regression; no unresolved product finding. Browser/assistive-technology audit limitations retained above.
