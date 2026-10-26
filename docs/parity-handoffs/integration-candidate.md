# Foundation composition candidate

Private local/remote branch `codex/parity-integration-candidate-20261026`, independent checkout `/workspace/caiwu-integration-candidate`. This is an existing-slice composition candidate, not another module wave or an accepted product release. No main merge, visibility change, original program execution or real book access.

Exact inputs supplied by the parent:

- Shared foundation `e15fb7f289eecf8ecaa003aae586860ae70b45f5`; separate PR52.
- Shell code `cde5f6863dc3aebc52adac0f8d7dbe087ec67113` plus its prerequisite handoff; picked as b08af7a/913d900. No shell/MainWindow edits by integration.
- Cashier corrected head `5fe65fecc03a5ecc2764303a3c6f15469e7c59bd`, including its complete baseline-relative commit chain; picked through cbf840e. It supersedes the earlier 346b3ec candidate. No cashier source edits by integration.

The only new implementation here is integration-owned `tests/ParityAcceptance/Authorization`, wiring the **actual** AuthorizedLedgerService(PreviewLedgerService(LedgerService)) to real LocalOperatorService/FileOperatorStore and actual SqliteLedgerStore. A test observer checks the real identity file lock remains held through Core reads and storage writes; it does not replace business behavior. There is no boundary-probe ledger in this test.

Six Linux composition scenarios currently pass: trusted actor/context/identity lock, two required write permissions and denial, default policy and Preview denial, logout/password revocation/fixed old facade, real SQLite ABORT propagation and total rollback, and the actual ParityCashierStore→CashierService→CashierVoucherProposalAdapter round trip. The last scenario saves precise cashier openings, adds a source document, calculates a plan, atomically accepts a draft and source receipt, reopens via a second protected connection, rejects source reuse/deletion and rejects a stale cashier decision after an unrelated real GL change. Test-only grants are explicit; the actual App still grants no modules automatically.

Run with SDK10.0.402:

```sh
dotnet restore tests/ParityAcceptance/Authorization/Caiwu.ParityAuthorization.csproj --locked-mode
dotnet run --project tests/ParityAcceptance/Authorization/Caiwu.ParityAuthorization.csproj -c Release --no-restore -- artifacts/authorized-integration.json
```

The candidate's exact-SHA Windows workflow additionally invokes the shell owner's actual Windows host and the cashier owner's actual WPF CAS regression, both bounded as separate processes. The cashier WPF case uses its explicitly labeled racing ledger double; the composition test above provides the distinct real Core/SQLite evidence. Shell PNGs retain their actual rendered window dimensions; no resize/upscale is used. Physical keyboard/IME, original runtime comparison and installed production lifecycle remain untested.

Current scope is the common foundation and one existing business adapter. Other module SHAs remain read-only handoff inputs; no ledger/inventory old or pending fixes were integrated. Original SQL Anywhere compatibility, stable rich LineId/auxiliary/currency/quantity semantics, per-original-menu permissions, shared inverse operations, module-specific copy rebinds, complete templates/reports and all original parity gates remain open. Cashier's state payload retains the source BookId on a raw full copy and its current adapter rejects that foreign identity; lossless explicit module rebind is pending. Saving original bytes does not mean every module is already usable after copy.

Journal guards cover the supported Store.Write path and the reviewed legacy delete/reinsert writer. They do not guarantee safety for arbitrary external SQL; INSERT OR REPLACE with recursive_triggers=OFF is outside this supported path. No existing production writer using that operation was identified by the parent reviewer. Unknown SQL clients must not be treated as supported writers.

Final candidate commit, Windows run and remaining failures are recorded after execution; this initial paragraph is not a pass for unexecuted Windows code.
