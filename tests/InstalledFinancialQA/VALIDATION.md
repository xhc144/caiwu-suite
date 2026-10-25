# Installed financial business QA — handoff

Private draft [PR35](https://github.com/xhc144/caiwu-suite/pull/35), base `codex/release-candidate` at `e7bba0b59e8e7282af574f33065eeeedf8d788a1`. That base differs from tested production `dece298946d03ad88c5031eb02dab8f87c330046` only in evidence/documentation. This task changes only `tests/InstalledFinancialQA/**` and `.github/workflows/windows-installed-financial-qa.yml`. Production, original InstalledDesktop controller, installer preparation, Core/Contracts/Storage and delivery hold remain byte-identical to the production baseline.

Checkout: `/workspace/caiwu-suite-financial-qa`; mounted `book-project` was not modified. Repository/ancestor `.agents` contained no applicable AGENTS.md or repository SKILL.md. The engineering-handoff-memory skill was read; these are ordinary versioned evidence records, not Handoff MCP events.

## Final verified execution — 2026-10-25 12:35 UTC

Exact runtime/payload source **`e10af681d276c1067e013f1e259c2d921239b9c3`**, [Windows run40193277510](https://github.com/xhc144/caiwu-suite/actions/runs/40193277510), **success**, job121168654189. All four cases and **48 observed assertions passed**. Later commits saving this record and raw evidence do not relabel their source as the tested binary source.

| Case | Actual observed result | Final status |
|---|---|---|
| Cost | native grid labor80→84, allocation, final250→254, managed save/register, native reopen and recalculate254 | passed |
| Nonprofit | actual main Desktop entry, explicit synthetic classification import and real review-evidence edit/save/register/reopen, real two-table110/10 preview, invalid-account error clears both old tables and disables exports | passed |
| Designer | actual formula grid edit `[periodDebit]-[periodCredit]`, specific calculated bank cell10, native template save/register/reopen and recalculated cell10 | passed |
| Complete restore | actual App backup/restore menus, actual new physical target, all five registered files across four codecs, exact hashes/native versions/full snapshot, original ledger and global identity boundary | passed |

[Artifact12599161317](https://github.com/xhc144/caiwu-suite/actions/runs/40193277510/artifacts/12599161317): **4,585,685 bytes**, ZIP SHA256 **`fa9430da44c49b5cb265833b940d1780b8d13454883f9fe31f64e95c9812c59e`**. Downloaded through the supported GitHub artifact tool; local ZIP digest equals GitHub digest. Every runtime-reported file size/SHA256 matched. The actual trusted receipt's manifest hash independently matches the raw backup manifest. No installers or payload binaries were uploaded by this workflow.

Raw final evidence is preserved in [`evidence/e10af68/`](evidence/e10af68/): `financial-results.json`, `actual-restored-readback.json`, `restore-ledger-diagnostics.json`, actual trusted receipt/backup manifest, exact registered attachment inventory, synthetic provenance, loaded dependency paths, native filename readbacks and logs. `artifact-verification.json` records all retained file hashes. Nine raw PNGs are all **1920×1080** and were individually visually inspected; `visual-review.json` records dimensions, hashes and observations. They are native screen captures, never generated or stretched.

The registered source physical instance was `a513c8e4-f8da-41e1-bfea-2e038b2f753a`; actual restored physical target is `Books/9462d1dc7d554de7965ba418c7a10163/ledger.caiwu`, a different registered instance with the same BookId `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`, revision1 and two posted vouchers. Both full semantic snapshot hashes equal `3738393efec2ff3ccec20da27c668fe968ad270ac6eddbe9fce0497ae52a8959`; source/restored explicit1002 balances both equal110. `BookInspection.fileSha256Basis` is `sqlite-consistent-copy`, not a fingerprint of live main-file bytes. The separate original main-file SHA256 `5f6bf1ace9c9d22c19105485bbd14365f506a937fa1348acec1c4e7360d675f9` remained unchanged, as did the global identity file.

| Native codec | Actual registered and independently matched files |
|---|---|
| `cost-worksheet-v1` | actual UI-saved worksheet JSON; input labor84 / final254 |
| `nonprofit-classification-v1` | explicit synthetic input JSON and actual UI-saved reviewed JSON |
| `report-template-v1` | actual UI-saved/reopened formula template JSON |
| `summary-v1` | actual normal-menu initialized summary catalog JSON |

All five entries have equal source/restored key, codec, SHA256 and native content/version. Complete membership was compared on the actual restored instance; source checks or a UI success message alone are insufficient. The backup explicitly excludes global identities. There is **no remaining blocker in this delegated scope**; root still owns integration and any final user-delivery approval. No new production defect was demonstrated.

The controller is an external console UIA/native-input observer. Product process must run from the installed, hash-verified self-contained payload and load coreclr/hostfxr/SQLite there, outside the source checkout. Synthetic identity and SQLite/classification setup occurs before App launch using ordinary APIs and genuine managed leases, then the fixture releases those leases. The product launches through installed `launch-managed`, rejects a wrong password, logs in explicitly, locks the actor, and owns both real non-shareable install/data OS leases. The nonprofit source remains an explicitly experimental read-only ledger; preview modules do not write or post its accounting data.

## Three module chains passed; recovery-oracle repair

[Run40192856526](https://github.com/xhc144/caiwu-suite/actions/runs/40192856526), source `43ea243ea752f0aab9a8c2c9bae88a5eaae23ac3`: **costing, nonprofit and designer passed**. Cost UI reopen recalculated254. Nonprofit actual two-table preview showed110/10; native save/edit/reopen worked, invalid explicit account error disabled both exports and left both old report grids empty. Designer's actual added calculated column bank cell was10, including after native template reopen. Five actual registered attachments across four codecs were backed up and restored via the real App menus, and original ledger/global identities retained exact hashes. The final independent restored-target assertion **failed**, so complete restore is not certified by this run.

Cause found directly in the helper code: `BookOperations.BankBalance` is optional and selects only the literal display name `银行存款`; the explicit synthetic fixture calls its1002 account `合成银行`, so that display-name lookup returnsnull. `e10af68` preserves full BookId/revision/snapshot/voucher equality and the helper-field equality, and separately requires both real source and restored account1002 balances to equal110 by opening balance plus posted lines. It writes raw diagnostic values before assertions and retains the actual trusted receipt. This corrects the test's oracle without changing production or relaxing full snapshot/attachment checks.

Artifact [12599140616](https://github.com/xhc144/caiwu-suite/actions/runs/40192856526/artifacts/12599140616), 4,599,560 bytes, SHA256 `57c3c6e76f4049140addaedd888ff96e7b3e3599d9ea4d71b142db79f183acb1`, was downloaded through the supported GitHub tool and its ZIP digest matched. Selected raw report, actual backup manifest and registered attachment inventory are in `evidence/43ea243/`. All nine PNG dimensions were read as1920×1080. Cost reopen and all three nonprofit report/error screenshots were visually inspected and show the claimed values/empty error report. No product defect has been demonstrated by the two controller failures.

## Earlier exact-source result and repair

[Run40192430675](https://github.com/xhc144/caiwu-suite/actions/runs/40192430675), source `492fd887cdafb98fd67b8ddffdd43b5c1f07ce8e`, **failed** at the cost native JSON reopen. Its real installed login, leases/dependency locations, sample250, native grid labor80→84/final254, allocation rows, managed save/register and independent saved JSON input84/result254 were observed. Nonprofit, Designer and complete restore were **not run** in that attempt.

The native path readback captured only an input prefix while SendInput was still being consumed. Raw native screenshot later shows more of the queued path. This is controller timing evidence, not a demonstrated product defect. `5f0916f` waits until the actual filename edit exactly equals the full requested path before any confirmation; it retains the strict path equality check. No path approval or session/lease requirement was relaxed. The intermediate source runs `40192785516` (`5f0916f`) and `40192823174` (`2b1f230`) were cancelled as superseded; neither is business success.

The failed run artifact [12598538659](https://github.com/xhc144/caiwu-suite/actions/runs/40192430675/artifacts/12598538659) was downloaded with the supported GitHub artifact tool. ZIP: 1,583,164 bytes; SHA256 `e4626a14d371ba57d0d973f28bbfdf7c5539202fb02bc0abee7cc3d979f1cb14`, verified locally against GitHub digest. Selected raw failure report and truncated input evidence are preserved in `evidence/492fd88/`. Its original native cost-allocation PNG was visually inspected and shows final254 and actual allocation rows; it is not a substitute for the later complete case.

## Files and checks

- `Program.cs` (high): synthetic setup, installed source/session/dependency/lease validation and exact partial JSON status. Compilation verified, actual login/setup demonstrated by the first Windows report.
- `Native.cs` (high): out-of-process UIA, real SendInput, native filename confirmation, native screenshot capture and actual minimum1920×1080 display mode. Adapted independently from existing InstalledDesktop; that controller is unchanged.
- `Cases.cs` (high): real cost/nonprofit/designer and complete restored-target assertions, with independent native-codec/SQLite readback. All four cases passed in the exact final Windows run.
- `run.ps1` (high): clean disposable runner, actual NSIS install, controller watchdog, strict result gates and ordinary native uninstall of its own synthetic installation. First Windows run exercised setup/cleanup.
- workflow (high): existing pinned Windows runner/.NET/NSIS/candidate preparation; no publishing; evidence-only upload. Path filters exclude documentation/evidence-only handoffs from repeating an already completed business run.

Official pinned .NET10.0.402 Linux SDK download was SHA512-verified against `docs/sdk-metadata.json`. Controller cross-build with warnings as errors passed (0 warnings/0 errors); git diff whitespace checks passed. Final Windows exact-source preparation/build, native installation/business execution, ordinary uninstall cleanup and source/hold preservation all passed. Earlier failed runs remain recorded above. A build, menu entry, intermediate cancellation or partial module result never certifies the complete business case.

## Limits and authority

Only synthetic data. Native PNGs retain the actual desktop resolution and are not stretched or generated. Reported reconciliation is an explicit limited calculation preview; no complete statutory compliance claim. No printing/PDF, physical keyboard/IME matrix, other DPI, broad financial correctness certification, native upgrade or portability coverage is inferred from this fixture.

No main merge, public publication, Release, new credentials/permissions/signing trust, quota purchase or original installer execution/upload occurred. `DELIVERY_PAUSED.md` is preserved. This PR is private and draft; final integration belongs to the coordinating root. No auto-review action denial has occurred in this task.
