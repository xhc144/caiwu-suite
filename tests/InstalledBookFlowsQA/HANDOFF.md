# Installed Desktop book-flow handoff

Scope: private `xhc144/caiwu-suite`, branch `codex/installed-bookflows-qa`, draft PR36 targeting `codex/release-candidate`. Independent checkout `/workspace/caiwu-suite-bookflows`; mounted book-project unchanged. Only `tests/InstalledBookFlowsQA` and `.github/workflows/windows-installed-bookflows-qa.yml` are edited.

Baseline production SHA: `dece298946d03ad88c5031eb02dab8f87c330046`. Starting candidate `2707a72ffe1b73fed715517802e6ad62e48fe611` adds evidence/documentation only. Production `src` tree remains `3854470d5c59e25d92c0e2f567a4ea8decbf8c27`. Existing InstalledDesktop controller, release hold, production MainWindow, credentials, permissions, release/publication settings are unchanged.

This controller drives the actual installed self-contained Desktop using normal login and controls. It creates only fresh synthetic identities/data, preserves provenance and managed path/lease gates, and never invokes a source project as the product. SQLite observations use read-only consistent capture; any writable open is confined to the disposable observation snapshot. A fresh installed helper process performs independent readback after App exit.

## Exact attempts

- `1cec21f25ee8245269506aceb703bc1bdbc59a26`, https://github.com/xhc144/caiwu-suite/actions/runs/40192446762: actual NSIS installation, normal login/create/save/distinct-actor review/post and both initial real OS leases observed. The first business case failed because the controller's raw live-file hash read disallowed the SQLite writer handle. Its error cleanup also mistook the book-prefixed main title for a dialog and closed App. Later failures are controller fallout, not independent product failures. Preserved raw diagnostic reports/native 1920x1080 PNGs in `evidence/1cec21f-diagnostic`. Artifact12598965141 ZIP SHA256 `11159cacf170d3103db5ef69f67c318df0fdb79b780fcd3bd81dff882fa8cb7e` exactly matches GitHub digest. Direct gh artifact download returned HTTP403; supported connected GitHub artifact tool succeeded. No remaining download blocker.
- `500024c15b4feb51550f491b19d732ffe5a06f52`, https://github.com/xhc144/caiwu-suite/actions/runs/40192804676: compilation failed on a missing explicit System.IO import in the new provenance-hash helper. All installed business cases not run. Build failure log retained in `evidence/500024c-compile-diagnostic`.
- `4e4d196857dd0c2df3f72f6dff4d53fda51b5bcc`, https://github.com/xhc144/caiwu-suite/actions/runs/40192921294: pending inspection. No business pass claimed here yet.

## Product gap and boundaries

Minimal source-inspected reproduction: normal login, create/open ledger, add/save a summary through 会计档案 → 常用摘要管理, close manager, Ctrl+N. The installed normal voucher editor has only account lookup and balancing tools; no summary choose/refill control is wired. The controller inventories actual buttons and captures the native window, then fails `summary-refill`; it never types/pastes the saved text directly and claims successful refill. Suggested root-owned fix: add a summary picker connected to the exact current physical book's registered catalog, carry original ledger/session and catalog versions, return a selected saved summary to the current voucher line, and preserve cancel/expired-context rejection. No production fix is made by this branch.

`stale-source-revision` remains explicitly not run: no supported normal installed UI action changes a source revision while its owned modal editor remains open. Writing behind the App-owned managed-data lease, changing synthetic credentials/permissions, or weakening the session context to manufacture expiry is not used. Changed-input stale preview approval rejection is a separate real installed test, not a claim of stale source/session coverage. The suite must fail for any requested failed or not-run case.

The added balance-page evidence waits for the actual selected 科目余额表 tab, visible TrialGrid and TrialTotalsText, posted amount123.45, visible page explanation and compositor settlement before native capture. Receipt binds page state, dimensions, amount and PNG SHA256. It does not reuse the old controller's mislabeled screenshot or alter product styles.

## Files

- `Program.cs` (medium until exact Windows report inspected): external UIA/native input orchestration, isolated cases, real leases and persisted readback. Shares reviewed native capture/input scaffolding copied from existing controller without editing it.
- `ProvenanceFingerprint.cs` (medium): expected persisted audit wire hash over independently captured fields; no copy execution or product writes.
- `Run-InstalledBookFlows.ps1` (medium): actual current-user NSIS install, external controller, separate installed helper, exact identity/count/balance checks, native uninstall retention, strict report/PNG/log artifact allowlist.
- workflow (high for checked initial paths/build/install): pinned existing Windows2025/SDK/NSIS pipeline, immutable clean source guard, preserved release hold; never uploads payload, installer, ledger DB, operator store, or reference materials.
