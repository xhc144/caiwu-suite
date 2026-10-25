# Operators Windows component acceptance — actual result

2026-10-25, completed before 12:15 UTC. Private repository `xhc144/caiwu-suite`, development branch `codex/module-operators-qa`, draft [PR32](https://github.com/xhc144/caiwu-suite/pull/32). No main merge, product deployment, permission changes, original-installer execution, original-package analysis/upload, or mounted-library access.

**PASS for the independent Operators component host.** The final Windows run [40187405947](https://github.com/xhc144/caiwu-suite/actions/runs/40187405947) executed tested code commit **`739b8dacda9187466a6c3907fe5d9de21ec714c7`**, job `121151331669`, on Windows Server 2025 / 10.0.26100, .NET SDK 10.0.402. Both actual Windows builds reported 0 warnings / 0 errors. The exact author's seven WPF scenarios and the additional ten native/identity/ledger scenarios passed. New-probe native `SendInput` delivered 2,762 events. JSON results and all eight synthetic window-content PNGs are retained in `evidence/`; these copies survive the Actions artifact expiry.

## Behaviors established

- First-use Escape cancels without writing an identity. Invalid setup stays open. Valid setup opens a separate login; cancelling that login returns no session. Explicit login is still required.
- Wrong login password leaves the actual window visible, clears its password, and focuses retry input. Native Tab/Enter/Escape, Unicode typing and mouse clicks exercise production controls. Cancelled/closed password dialogs clear secrets.
- Actual administrator UI creates preparer/reviewer accounts, changes roles, and disables an account. Old adapters reject reads/writes after role changes; a freshly logged-in preparer's adapter rejects writes after disable. The persisted SQLite ledger remains at its original revision with no vouchers. The last enabled administrator cannot be disabled. Non-administrators cannot construct management UI.
- Normal authorized `DesktopCompositionExample` factories wrap real Core and SQLite. An administrator has no implicit bookkeeping role. Caller-supplied display names and other users' ActorKeys cannot replace the session's immutable actor in preparation, review, posting or audits. Another preparer cannot edit the original draft; self-review remains denied after a display-name change.
- Authorized opening balances, preparation, independent review, cancel-review, review, posting, balance/ledger queries and month close persist correctly. Independent expected arithmetic: bank opening 100 + posted debit 10 = 110, capital closing credit 110.
- An actual production voucher editor captures the original authorized service and `LedgerSession` generation. Switching to a restored **different physical file with exactly the same BookId and revision** rejects its save, retains the editor, and changes neither file. Closing/reopening the same path also invalidates an old captured mutation.
- Wrong-current-password change remains open; successful change revokes the old session, rejects the old password, and permits explicit login with the new one.
- Compiled logout composition revokes the old login **before** closing the actual open production editor and owner window. After another operator logs in, the old adapter, Open delegate and service factory remain rejected and the actual ledger remains unchanged.

## Immutable source and artifacts

Production `src` tree: `febb3c197fb37b1195711442f384abb5ff86039f`. The manifest in `evidence/source-hashes.json` records every test/workflow file's Git blob and SHA256 plus the original script/composition blobs.

| Frozen production directory | Git tree | Reference |
| --- | --- | --- |
| `src/Caiwu.Operators` | `188771cbe328f6c41af5ab937cc370ef566ee282` | Operators `1957435365390756fd8267937fd0ec408b1e498f`, including first stage `7a1e673` |
| `src/Caiwu.Desktop/Themes` | `72ad713d1368a3b6cb78d094dc52fc7b328277fc` | Modern `98a43e0` |
| `src/Caiwu.Core` | `a4a0239e97b433708fe727d9e4ee2eca03ca793b` | v1.2 |
| `src/Caiwu.Contracts` | `5282011ae8b5e38250e22310c3006a5a02dc373d` | v1.2 |

Actual artifact archives were downloaded through the GitHub connector and verified against these GitHub digests before extracting:

| Artifact | Stable link | Archive SHA256 |
| --- | --- | --- |
| Original author's Windows smoke, ID `12597345494`, 73,608 bytes | [Download](https://github.com/xhc144/caiwu-suite/actions/runs/40187405947/artifacts/12597345494) | `1cd7f709b77d7ea2e8bff85680efab374cb66d99eb2f5084db46c96d22493099` |
| Additional native Windows/Core/SQLite probes, ID `12596438706`, 132,750 bytes | [Download](https://github.com/xhc144/caiwu-suite/actions/runs/40187405947/artifacts/12596438706) | `d6570a3909d8d87e59f4acba4f19aed4c894bea3d8152a668834770ee4b5341f` |

Artifact retention expires 2026-11-01. Durable `evidence/windows-native-results.json`, `evidence/author-smoke/results.json`, source hashes and PNGs contain only synthetic fixtures. The additional probe screenshots have empty masked password fields; the unchanged author setup screenshot has masked synthetic fixture input. No password or password hash is in results/logs. No identity files, databases, backups or application executables are uploaded.

## Integration

The implementation commits, in order, are `fca16ea45eb9f81ce1e17fa6f7aecea7575dc04a`, `9d67824f87e56e80ac6e36d218be85f6a0dbf916`, and tested final code `739b8dacda9187466a6c3907fe5d9de21ec714c7`. The following evidence-only commit adds this handoff and verified artifacts without changing executable source. Integrate via PR32 or cherry-pick the sequence and the evidence commit; do not merge main as part of this task.

Only `tests/Caiwu.ModuleWindowsQA/Operators/**` and `.github/workflows/operators-windows-qa.yml` are added. There are **no production fixes** or cross-directory edits. Keep the original Operators/Core/Contracts/theme pins, or review and deliberately update `prepare.ps1` before validating a changed baseline. Commands and precise composition points are in `README.md`. Physical-session protection requires `SessionBoundMutation` in addition to authorization; preserve the captured original service/generation and original v1.2 mutation tokens.

## Remaining boundaries and attempts

- Product `App.OnStartup`, installed product startup, candidate installation/update and global integration are **not tested here**. This group creates an independent `Application`, loads actual Modern resources and real component windows; it uses the author's compiled example rather than replacing the product entry point. Candidate-installation/real-product acceptance remains with owner `01a172b3-b22c-779c-9d2a-9c33d206d031`.
- IME composition, screen reader behavior, human physical keyboard operation, DPI/multi-monitor matrices and real user identity/ledger data are untested. Native Unicode injection does not establish IME support. PNGs render the real WPF window content, not the OS title-bar chrome.
- Visual review: first-use/login/password errors remain readable, login retry focus is visible, the management grid/roles and last-administrator warning are readable, and the stale editor retains its synthetic voucher plus the refusal message. The captured composition example shows the stable ActorKey in the voucher signature; any friendlier display-name rendering is a Desktop presentation integration concern, not an authorization substitute.
- First run `40187161029`: new ten-case probe passed, but the original smoke build failed because its ignored scratch checkout lacked the relative `packaging-next` Delivery dependency. Commit `9d67824` added a directory junction; second run `40187217215` passed both groups. The strengthened final code was then separately validated by run `40187405947`; no failure was hidden by using the earlier green run.
- Direct `gh run download` hit an artifact redirect HTTP403; the official GitHub download connector successfully materialized both final archives. No pending, denied or uncertain operation remains. No authentication-service or host-source defect requiring an owner patch was identified within these exercised flows.

File confidence: `Program.cs`/`NativeInput.cs` implement bounded actual Windows production-window scenarios; `LedgerCases.cs` uses real authorized Core/SQLite and captured editors; `prepare.ps1` pins/extracts author sources and records hashes; `run.ps1` enforces timeouts, complete result IDs, clean production source and image presence; dedicated workflow executes only this group and uploads explicit evidence allowlists. These purposes are supported by the final actual Windows run, not inferred from compilation alone.
