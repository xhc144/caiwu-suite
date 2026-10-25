# Copy / Summary / BookTools independent Windows acceptance

This test-only module targets the private development branch `codex/module-copy-summary-qa`.
No Desktop entrypoint, Contracts, Core, Storage, production module, installer or delivery hold is changed.
Only synthetic temporary books are opened. No commercial software or extracted data is used.

## Baseline and reuse

Started from integration `10e38ff65313aae5106a6b55c42790d47345b8fb`.
The following source subtrees were byte-identical by `git diff <author-ref> HEAD -- <paths>`:

- Voucher `54871a004a836d76824b2c29959e5b22139f4e86`: `src/Caiwu.VoucherTools{,.Wpf}` (includes `dab8681`).
- Summary `dcda051a0c9ee364ccff4c2b4c7085f446fac39d`: `src/Caiwu.Summaries` (includes `649df9e`).
- BookTools `8bbf8428ccd0b656fec83c7a1ede828cd5691442`: `src/Caiwu.BookTools` (includes `86a10e6` / `eb8f150`).
- Storage `4e8664d5db711b6fe8543a1bf3c689f3f39c2a30`: `src/Caiwu.Persistence.Sqlite`.

These commits were imported under different integration SHAs, so ancestry alone would misidentify them as absent. Nothing was cherry-picked again. The existing rollback-fixture fix is outside this focused test run. The independent test applications use .NET's built-in Fluent resources; Desktop's application startup/theme composition remains its owner's acceptance scope.

`AuthorVoucher/Program.cs`, `SyntheticData.cs` and `AuthorSummary/Program.cs` are byte-for-byte copies of the authors' existing smoke sources from the SHAs above. Assertions are preserved. Their original runner scripts are reused with only the relocated project/repository paths adjusted; outer `run.ps1` bounds the Summary process and binds all files to checkout SHA. Their project references point at the current integration production sources.

## Run and evidence

On an interactive Windows desktop with .NET SDK 10.0.402:

```powershell
./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module Voucher
./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module Summary
./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module BookTools
```

Use a fresh output directory for every run. The dedicated workflow triggers only on the QA branch and runs these three modules independently, immediately uploading each job's PNG/JSON/log artifacts with the actual checkout SHA in the artifact name. Any process/modal timeout is a failure, never skip/pass. One supplementary case failure does not prevent independent cases from running. No full Core or Storage suite is invoked.

- Voucher author probes: 12 actual modal-window checks for inputs, errors retained, correction, cancellation, routed Escape, copy-plan return, original token preservation and host-only save.
- Summary author smoke: actual management controls, JSON persistence/reopen, version conflict, real Windows replacement sharing failure/retry, unsaved cancellation, focus restoration, damaged catalog and book isolation.
- Supplementary probes: actual voucher focus and Core+SQLite save/stale rejection; malformed UTF16 queries clearing/rejecting old summary selection; BookTools invalid preview, explicit confirmation, input invalidation, cancel without publication, both scopes, stale-source error retained, in-flight safe cancellation; 30 barrier-synchronized Windows same-target publication races using separate services/different sources, requiring one winner, unchanged source bytes and winner bytes surviving loser cleanup.

The supplementary screenshots use native `PrintWindow` at the actual HWND's dimensions, without crop/resize/upscale. The unchanged author probes use WPF `RenderTargetBitmap` of their actual displayed windows; these are identified separately and do not prove desktop compositor rendering. `evidence-manifest.json` binds every raw file's SHA256/size to checkout and relevant Git subtree identities. Supplementary JSON also describes native capture dimensions/DPI/hash.

Inputs use actual control properties and WPF RoutedEvent Click/Key. Focus checks inspect actual keyboard focus. Native physical keyboard, mouse, IME, DPI matrix, accessibility, host-menu wiring and production financial compliance are not asserted.

## Integration

Cherry-pick only this QA branch's new commits onto the compatible integration baseline. No solution changes are needed: run the three commands above. The workflow's branch filter intentionally stays QA-only; the integration owner can run scripts directly or explicitly adapt their own CI. Recheck `sourceTrees` when combining later production fixes; a result for one SHA does not certify a changed subtree.

Runtime results and remaining issues will be recorded in `HANDOFF.md` after the actual GitHub Windows run. Compilation by itself is not feature acceptance.
