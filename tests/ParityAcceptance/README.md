# Parity integration acceptance boundary

This executable creates and deletes its own synthetic SQLite books. It exercises the new shared module API with independent SQL queries, an actual SQLite ABORT trigger, two distinct concurrent connections, backup/restore, source-consumption recovery and cross-book rejection. It never reads real books or executes the original software. `integration.json` distinguishes a working-tree diagnostic from a verified clean exact-SHA run.

Run after committing a clean tree with the pinned SDK:

```sh
dotnet restore tests/ParityAcceptance/Caiwu.ParityAcceptance.csproj --locked-mode
dotnet run --project tests/ParityAcceptance/Caiwu.ParityAcceptance.csproj -c Release --no-restore -- artifacts/parity-acceptance/results.json
```

`CAIWU_PARITY_COMMIT`, `CAIWU_PARITY_TREE` and `CAIWU_PARITY_SOURCE_CLEAN=true` must only be set after independently checking HEAD, its tree and a clean Git status. The Windows runner performs these checks before and after execution, verifies SDK10.0.402, runs full Core/SQLite regressions, and records file hashes:

```powershell
./tests/ParityAcceptance/Run-WindowsParity.ps1 -ExpectedCommit <full-40-character-SHA> -CaptureNative
```

The native capture invokes the existing self-authored product harness with synthetic identities and data. It requires an actual foreground Windows desktop at least 1920×1080 and captures native pixels without resizing. These are **rendering diagnostics of this exact source**, not evidence of original UI parity or of a user's workflow. After the shell owner's SHA is integrated, fresh captures and original-window observations must be collected and compared with the [PR40 checker](https://github.com/xhc144/caiwu-suite/pull/40). The original program remains prohibited. The existing harness may need a shell-owner adaptation when owned window APIs change; integration does not edit that owner's UI files.

Original parity gates remain open, including all rows of [gap-analysis](../../docs/original-analysis/gap-analysis.md): SQL Anywhere compatibility, original menus/windows/relative button positions/events, reverse operations, auxiliary/currency/quantity behavior, complete regime templates, reports/printing and every subsystem. Module document preservation is a storage capability; it does not implement those business rules. Test counts and compilation cannot satisfy these gates.

The module journal is authoritative data inside atomic audit events. New storage retains those exact rows and installs database triggers rejecting DELETE/UPDATE by legacy whole-audit-rewrite clients; an old writer can fail safely rather than silently clear module state. Audit export/filtering is presentation only. Backup/restore carries the journal and guards. Full BookTools copying preserves opaque history and uses source revision+1 when module events exist; receipt revisions and embedded source BookIds remain historical. Accounts/openings copying excludes module data explicitly. Replay requires every constructor property, so a missing Document cannot become an implicit deletion. Replay currently reads the complete ledger history; large-data performance/index migration is a separate pending item. A document replacement is explicit and owner-controlled: adapters must retain unknown fields rather than reconstructing a lossy DTO. No cross-file transaction is claimed.

Production wiring is pending shell-owned extensions of both AuthorizedLedgerService and PreviewLedgerService. Domain actor text is not authentication; never hand a raw LedgerService to module UI. The fixed live OperatorSession must authorize and execute under the same LocalOperatorService.Execute lock, and the unverified-regime write policy must remain in the call chain. These authorization/preview tests are owned by shell and are not claimed by the Core synthetic fixture.
