# Windows rollback fixture compatibility

Test-only implementation commit: `549b4e6f90f1a62df6e34ad2a84a2c0f67c6cf02`, based on integration `63ab96540e587c4917390a64907ee631c4cfc898`. Only `ReadbackTests.cs` changes; production SQLite source tree is unchanged (`ce45cb6c52a7e980b43adbd7d8da65f1c6ff7a9d` before and after). No sharing flag, safety gate, package, workflow, or production code changes are required.

Linux and actual Windows full suites both pass **117 tests, 0 failed, 0 skipped**, including the original 116 tests plus one new sensitivity control. [Windows run 40183699168](https://github.com/xhc144/caiwu-suite/actions/runs/40183699168), on the exact implementation commit, passed the full suite in both the main component script and the independent SQLite step. The latter also passed all **12/12** original create-race repetitions. Before/after TRX comparison confirms **all 45** original Windows failures are present and now pass; none is missing or skipped.

Both platforms report Store **63/63**, Readback **47/47**, Publication **7/7**. This includes actual transaction rejection/rollback, stable byte equality, the committed-change sensitivity control, and the unchanged WAL/backup and atomic-publication cases.

## Exact Windows baseline failures

[Run 40182073681](https://github.com/xhc144/caiwu-suite/actions/runs/40182073681), source `5e21ac321f119efd30a4a11780b27ee651f58221`, Windows Server 2025 / .NET 10.0.13: **71 passed, 45 failed out of 116**. Artifact `12595176101` is `caiwu-windows-revalidation-24`; its standalone SQLite script's `full.trx` was downloaded and parsed, not inferred from the total or a screenshot.

| Original failed cases | Count | First test-owned stack frame | Intended assertion still retained |
| --- | ---: | --- | --- |
| All persistent fields and list order | 38 | `RefusedAndUnchanged`, old line 72 | Exact semantic rejection, complete snapshot/input unchanged; valid write after removing the trigger |
| Balanced totals with redistributed line amounts | 1 | Same helper, old line 72 | Reject 10+20 → 9+21 even though counts and total 30 agree |
| Fractional cents, REAL and TEXT | 2 | Same helper, old line 72 | Reject non-integral cents without coercion |
| Extra unowned lines | 1 | Same helper, old line 72 | Reject ghost rows omitted by snapshot materialization |
| Extra ledger row | 1 | Same helper, old line 72 | Reject rows hidden by singleton filtering |
| Silent line conflict IGNORE and REPLACE | 2 | Conflict test, old line 330 | Require `InvalidDataException`, original state and bytes, independent SQL integrity/revision/line diagnostics and reopen |

All 45 fail in `File.ReadAllBytes`, before their write attempt. The stack enters `SafeFileHandle.CreateFile` / `File.OpenHandle` and reports that the synthetic `.caiwu` file is in use. The same run's twelve original create-race repetitions all passed, and the seven publication regressions passed; neither is the source of these 45 failures.

The cause is the fixture's lifetime: it keeps a writable SQLite connection open while `File.ReadAllBytes` opens a reader that does not share writes. The [.NET 10.0.13 source](https://github.com/dotnet/runtime/blob/v10.0.13/src/libraries/System.Private.CoreLib/src/System/IO/File.cs#L637) explicitly uses `FileShare.Read` for that reader. Windows enforces the sharing conflict even when the SQLite connection is currently idle. Production file-sharing policies remain untouched.

## Stable-file comparison protocol

The fixture has no competing writer. The helper now:

1. Reads the original full snapshot and serializes the input exactly as before.
2. Asserts that SQLite reports **DELETE** journal mode; it does not switch the mode or silently checkpoint a WAL fixture.
3. Disposes the seed store and closes the raw SQL connection before capturing baseline bytes using unchanged `File.ReadAllBytes`.
4. Opens a separately scoped writable attempt, requires the same exact semantic exception, and verifies original state/input while that attempted connection remains open.
5. Disposes the attempt before comparing the closed standalone database's complete bytes.
6. Independently reopens, compares the original snapshot, and checks integrity.

`Pooling=false` in the unchanged storage implementation makes disposal release the underlying handles. The helper deliberately consumes/closes the supplied seed store. The field-variation caller consequently opens a fresh accepted-write store after dropping its trigger; its exact `Next()` state assertion remains.

IGNORE/REPLACE use the same closed-file boundaries and retain their independent SQL diagnostics and full-state assertions. No exception is caught and converted into success, and none of the 45 original cases, triggers, byte equalities, or snapshot comparisons is removed.

These byte comparisons do not claim to be a live/WAL snapshot protocol. The unchanged `BackupCopiesCommittedWalPagesAndExcludesUncommittedChanges` and `BackupsDuringConcurrentCommitsNeverMixRevisions` tests retain the separate SQLite-consistent WAL/concurrent-backup coverage. The DELETE-mode assertion makes a future accidental WAL conversion fail explicitly rather than treating the main file as the entire database.

## Sensitivity control

`Closed_file_byte_comparison_detects_a_committed_same_length_change` closes all handles around its two byte captures, commits a same-UTF-8-length synthetic book-name change through independent raw SQL, requires equal file lengths but unequal SHA256 hashes, and independently reopens to verify the changed name and integrity. A real persisted change remains observable; the compatibility repair is not merely permitting reads or accepting arbitrary errors.

## Evidence and integration

The evidence directory records the baseline failures and Linux/Windows results. TRX copies may normalize line endings and trailing output whitespace for repository review; counters, test identities, assertions and stacks are retained. Original baseline `full.trx` SHA256: `7846df2afe8681cad6c542a1c517b897bfe5904fe8c75e31610a5c32486b8056`. Original Linux result SHA256: `991a103c69db7fd9d052105c218e741e88e5892e01dbbf7cda4119b0dbe2d455`.

Windows after artifact: `12594744892`, `caiwu-windows-revalidation-25`, archive digest `87894705f7b523cccb8aa04a384deba22eb87fd406e4c76d37126b184cf9519c`. Original Windows after `full.trx` SHA256: `3e7120e46f7522ab647b4da5080e4a3d937004a8ae6bccf5fad7a1183afe7693`. `windows-recovered.json` maps each of the original 45 failing test names to its actual Passed result. The twelve per-run TRX files and the standalone script's summary are retained as well.

The **overall workflow remains failed**, independently of the successful SQLite suites. At `2026-10-25T10:14:40Z`, the main component script reached `tests/Caiwu.Acceptance/Wpf/run.ps1:12`, which refused `Reviewed production sources have local edits; refusing ambiguous source identity.` The later independent WPF step and all subsequent steps, including SQLite and the no-distribution-archive check, succeeded. This task did not alter that source-identity guard or investigate/repair files outside its ownership. The exact dirty source files are not identified by that log; determining them remains with integration. See `workflow-boundary.json`.

```sh
git cherry-pick 549b4e6f90f1a62df6e34ad2a84a2c0f67c6cf02
tools/dotnet-local.sh test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj -c Release
```

Windows uses the existing `tests/Caiwu.Persistence.Sqlite.Tests/CreateRace/run-windows.ps1`, including the full suite and twelve isolated original-race repetitions. The delivery hold and install/upgrade book protections remain in force. Only synthetic temporary directories are used.
