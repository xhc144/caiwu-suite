# SQLite ledger store

`SqliteLedgerStore` implements the frozen `Caiwu.Contracts.ILedgerStore` contract on .NET 10. It depends only on Contracts and the official `Microsoft.Data.Sqlite` package, fixed to **10.0.13**. NuGet lock files also pin transitive dependencies. No Core, desktop, or solution changes are required in this branch.

```csharp
using var store = SqliteLedgerStore.Create(path, book, accounts);
var current = store.Read();
store.Write(next, current.Revision); // next.Revision must be current.Revision + 1
store.BackupTo(newBackupPath);
SqliteLedgerStore.RestoreBackup(newBackupPath, newLedgerPath);
```

- Create starts at revision zero. Open uses `ReadWrite`, never `ReadWriteCreate`, and rejects missing files, read-only files/directories, malformed databases, foreign databases, and unsupported schema versions. Open checks integrity, foreign keys, decoding, and a rolled-back write probe.
- Schema 1 uses STRICT relational tables, `application_id=1128355669`, and `user_version=1`. Foreign keys are enabled on every connection. Parents may appear after children in input lists. Audit voucher IDs intentionally have no foreign key, because audit history must survive draft deletion.
- Every DTO field and list order is preserved. DateOnly uses ISO dates; Guid uses `D`; DateTimeOffset uses `O`, preserving offset and ticks. Amounts are SQLite INTEGER/Int64 cents. Fractional cents and values outside `[-92233720368547758.08, 92233720368547758.07]` are rejected with `LedgerValidationException`. Trailing decimal zeroes do not change the monetary value.
- Write performs a full snapshot replacement inside one immediate SQLite transaction, with revision CAS and same-book identity validation. Failed inserts, constraints, and commits roll back the revision and all tables. SQLite/storage exceptions propagate. Accounting workflow rules remain the responsibility of Core.
- Read uses one read transaction, so metadata and all relation tables come from one database snapshot. Public operations and disposal are serialized per store; separate store instances coordinate through SQLite locks and revision CAS. Lock contention can time out after 10 seconds and propagate `SqliteException`.
- Backup uses `SqliteConnection.BackupDatabase`, including committed WAL pages. The result is checked, decoded, and switched to DELETE journal mode before publication as a standalone file. Restore can read a read-only backup and uses the same consistent backup API.
- Create, BackupTo, and RestoreBackup **all reject existing destinations**. They populate a unique file in the destination directory and publish by a move with overwrite disabled. Failed staging is cleaned up. Backup/restore reject the source and its SQLite sidecars, including directory symlink aliases. Existing hard-link/file-symlink aliases are rejected as existing destinations. Destination directories must already exist.
- Dispose closes the owned connection without pooling. Operations after disposal throw `ObjectDisposedException`. DatabasePath is an absolute path with existing symbolic links resolved.

Schema 0 and unknown schemas are rejected; no legacy importer or automatic schema migration is included. The caller owns lifecycle and user-visible error handling. SQLite transactions and FULL synchronous mode provide the durability supported by the underlying filesystem; staging publication is not a substitute for filesystem or hardware failure recovery.

## Verification

```sh
dotnet restore tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj --locked-mode
dotnet test tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj -c Release --no-restore
```

Tests use actual SQLite files and independent raw SQL, including Int64 endpoints, foreign-key/trigger failures, concurrent writers/creators, committed and uncommitted WAL transactions, live backups during writes, corrupted and future-schema files, read-only paths, restoration, and isolation between books. Linux-only permission/symlink cases are guarded on Windows. Windows execution is not claimed by the Linux run.

Executed on 2026-10-25, Debian 13 x64, SDK 10.0.402/runtime 10.0.13: locked restore succeeded; Release tests **63 passed, 0 failed, 0 skipped** (TRX: `/workspace/caiwu-tooling/test-results/sqlite-release.trx`). Release library build succeeded with **0 warnings, 0 errors**. No approval denial or unresolved build/test blocker occurred in this environment.

Official references checked on 2026-10-25:

- [Microsoft.Data.Sqlite 10.0.13](https://www.nuget.org/packages/Microsoft.Data.Sqlite/10.0.13)
- [Transactions](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions)
- [Online backup API](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/backup)

The build SDK is **10.0.402**, matching the repository's global.json. The Linux x64 archive was downloaded from `https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.402/dotnet-sdk-10.0.402-linux-x64.tar.gz` and verified against the [official release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json), SHA512:

```text
1904a98dda2db34ba78ba3c4fb1b224455329af91c341d83547843c1839e112b04ae699ee92fa2449a8f62249196a938723078c0c60b9f65c88539d5687729c2
```

For a read-only host home, use a writable tooling directory outside the repository for `HOME`, `DOTNET_CLI_HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `NUGET_PACKAGES`, `NUGET_HTTP_CACHE_PATH`, and `NUGET_PLUGINS_CACHE_PATH`. This run used `/workspace/caiwu-tooling/`; SDK installation and NuGet migrations did not require host-home writes or permission changes.
