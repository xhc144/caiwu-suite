# SQLite concurrent publication repair

The SQLite-only repair passes the original **109/109** tests and all **7/7** new regressions on Debian 13 x64, SDK 10.0.402 / runtime 10.0.13. The complete suite passes **116/116**. All databases and payloads are synthetic, created under unique temporary directories.

| Check | Before | After |
| --- | --- | --- |
| Original create race, 12 separate test invocations | 8 passed, **4 failed** (runs 1, 8, 9, 12) | **12 passed, 0 failed** |
| Original full suite | 109 passed in this invocation; it missed the race | **109 passed** |
| New regressions on tmpfs | 3 passed, **4 failed** | **7 passed** as part of the 116-test run |
| New regressions on overlayfs | Not run | **7 passed** |
| Library Release build with warnings as errors | Not separately recorded | **0 warnings, 0 errors** |

These are this task's actual runs. The upstream integration report's 108/109 full-suite result and 10/12 isolated failures are separate earlier evidence. A single baseline pass did not establish safety.

## Reproduction and cause

Base: PR16 `codex/sprint-integration-2` at `e9c436803d287937d5314e6bd3f7360e71b219ff`. The supplied `1ee03605b03522e877476466660aa9ecacaadaa7` is its immediate parent; the additional changes are unrelated native-focus tests and CI configuration. No original installer or newly derived catalog was read or uploaded.

The before regression run used the new tests against the unchanged baseline storage implementation. It failed in dedicated-thread publication and independent-process publication, Create, and BackupTo. The Create subprocess reported `Creator returned another book.`; BackupTo reported `Published book was replaced.` Restore happened to pass that baseline invocation.

The baseline syscall trace captures two distinct thread IDs, two different exclusively created staging names, one destination, and two successful replacing renames:

```text
2915 rename(".../.caiwu-8102676d63cd4ec88d1b522011e157a9.tmp", ".../threads-6.txt" <unfinished ...>
2914 rename(".../.caiwu-049cdd8cd42d4373a3bf11403c9dd872.tmp", ".../threads-6.txt") = 0
2915 <... rename resumed>) = 0
```

See the unabridged [before trace](evidence/before/staged-publication.strace). This matches the [.NET 10.0.13 Unix source](https://github.com/dotnet/runtime/blob/v10.0.13/src/libraries/System.Private.CoreLib/src/System/IO/FileSystem.Unix.cs): `File.Move(false)` can check destination absence and then use `rename`, allowing a competitor to publish between those two operations. The temporary-name generation and cleanup ownership were not the cause.

## Minimal production change

Only `SqliteLedgerStore.PublishNew` and its related comment/imports change. Schema, transactions, transactional readback, revision CAS, source protection, backup API, and restore validation are unchanged.

- Staging remains same-directory, random-name, exclusively created with `FileMode.CreateNew`; population/checks finish and connections close before publication.
- On Unix, `link(2)` publishes the entire staged inode under the new destination name. An existing file, directory, or symlink cannot be replaced. Error details are retained in the `IOException`'s inner `Win32Exception`. There is no replacing-rename or partial-copy fallback.
- On Windows, the existing `File.Move(stage, destination, false)` remains. The [.NET Windows interop source](https://github.com/dotnet/runtime/blob/v10.0.13/src/libraries/Common/src/Interop/Windows/Kernel32/Interop.MoveFileEx.cs) omits `MOVEFILE_REPLACE_EXISTING` for that operation. This is source inspection, **not Windows execution evidence**.
- The `finally` block removes only this operation's staging name and its journal/WAL/SHM names. It never deletes the destination. On Unix, removing the staging hard link leaves the published inode intact.
- Unix filesystems without hard-link support now fail safely with `IOException`. They are not silently handled using an unsafe move/copy. This compatibility limitation is intentional; no filesystem permissions are changed.

The after syscall trace records **64 successful links and 64 EEXIST rejections**, with no `rename` calls: [after trace](evidence/after/staged-publication.strace).

## Regression coverage

`CreationRaceTests` adds seven cases:

- 64 pairs of dedicated threads, synchronized after both staging payloads are complete; verifies distinct temporary paths, exactly one success, loser `IOException`, exact winner contents, and no staging leftovers.
- Four independent-process cases (Create, BackupTo, RestoreBackup, and the staged publication boundary), 16 pairs per case. Workers wait on redirected stdin/stdout gates, without sleeps, test retries, or serialized creation. Public operations use distinct synthetic book IDs and account contents; final identity, revision, integrity, source bytes and a later loser's inability to change destination bytes are checked.
- A destination created after staging must retain its exact bytes.
- Population failure cleans its own stage and sidecars while retaining an unrelated temporary file.

Each successful run covers 64 thread pairs plus 64 process pairs. The same seven regressions passed with `/tmp` on tmpfs and a separate `TMPDIR` on the workspace's overlayfs. The existing `StoreTests.RacingCreatorsNeverOverwriteTheWinner` assertions are unchanged.

The test project is executable solely to host the synthetic subprocess worker; VSTest still discovers/runs all tests normally. The private publication-boundary test uses reflection, avoiding any production test hook or public API change.

## Integration and commands

Cherry-pick this branch's single repair commit onto `codex/sprint-integration-2`; no Contracts, Core, Desktop, solution, workflow, or packaging changes are needed. The PR targets that integration branch, not main. Evidence is under this test-owned directory because the root handoff/docs directories belong to integration.

```sh
tools/dotnet-local.sh restore tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj --locked-mode
tools/dotnet-local.sh test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj -c Release --no-restore
# Original 109 cases only:
tools/dotnet-local.sh test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj -c Release --no-build --no-restore --filter 'FullyQualifiedName!~CreationRaceTests'
```

For the overlayfs check, set `TMPDIR` to an existing synthetic scratch directory before running the seven new regressions. Per-run TRX, before/after syscall traces, and the library build log are in [evidence](evidence). TRX is copied unchanged except removal of trailing whitespace on eight xUnit blank-output lines in `new-regressions-before.trx`. The complete after run's TRX is `evidence/after/sqlite-after.trx`.

For BookTools' separate owner: reuse the same publication rule in that module's own scope. Do not rely on `Exists` plus Unix `File.Move(false)`. Keep an exclusively owned, fully populated same-directory stage, publish with a filesystem operation that atomically rejects an existing name, and clean only that stage. No shared public helper or BookTools change is introduced here; extracting one would require integration-owned API/directory decisions.

## Remaining platform validation

Windows was unavailable in this environment; neither the PowerShell script nor Windows filesystem behavior has been executed here. Integration can run:

```powershell
./tests/Caiwu.Persistence.Sqlite.Tests/CreateRace/run-windows.ps1
```

The script records the full suite and all 12 original-race repetitions, including failures, in a new `artifacts/sqlite-create-race-windows` evidence directory. It requires the existing .NET SDK and performs no deployment, credential/permission change, installer execution, or user-ledger deletion. Windows local NTFS, network/remote shares, macOS, filesystems without hard links, directory fsync/power-loss durability, and external malicious namespace replacement are not validated by the Linux results. Delivery hold and installation/upgrade book protections are unchanged.
