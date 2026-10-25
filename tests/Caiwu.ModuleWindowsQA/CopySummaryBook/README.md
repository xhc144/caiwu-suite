# Copy / Summary / BookTools independent Windows acceptance

This test-only module targets the private development branch `codex/module-copy-summary-qa`.
The authorized follow-up changes only BookTools WPF work-area/layout handling. No Desktop entrypoint, Contracts, Core, Storage, copy plan/publication/persistence, installer or delivery hold is changed.
Only synthetic temporary books are opened. No commercial software or extracted data is used.

## Baseline and reuse

Started from integration `10e38ff65313aae5106a6b55c42790d47345b8fb`.
The following source subtrees were byte-identical by `git diff <author-ref> HEAD -- <paths>`:

- Voucher `54871a004a836d76824b2c29959e5b22139f4e86`: `src/Caiwu.VoucherTools{,.Wpf}` (includes `dab8681`).
- Summary `dcda051a0c9ee364ccff4c2b4c7085f446fac39d`: `src/Caiwu.Summaries` (includes `649df9e`).
- BookTools `8bbf8428ccd0b656fec83c7a1ede828cd5691442`: `src/Caiwu.BookTools` (includes `86a10e6` / `eb8f150`).
- Storage `4e8664d5db711b6fe8543a1bf3c689f3f39c2a30`: `src/Caiwu.Persistence.Sqlite`.

These commits were imported under different integration SHAs, so ancestry alone would misidentify them as absent. Nothing was cherry-picked again. The existing rollback-fixture fix is outside this focused test run. Original author applications use .NET's built-in Fluent resources. The supplementary application loads the exact production `Caiwu.Desktop/Themes/Modern.xaml` BAML without starting the product login lifecycle; this theme subtree matches `98a43e0`. Desktop's application startup and host wiring remain their owner's acceptance scope.

`AuthorVoucher/Program.cs` and `SyntheticData.cs` are byte-for-byte copies of the author's existing smoke sources. Summary preserves the original expected behavior, with scope diagnostics/failure screenshots and one evidence-backed reader correction: `BookScope` contains bound `Run`s, for which Windows reports `TextBlock.Text == ""` while the actual `TextRange` and screenshot contain the injected name/ID. The scope check reads that actual text and still requires the exact injected BookId and name. The original failure at `b65bd19` and its diagnostic reproduction at `c18b6e8` are retained in their CI artifacts; no production change was made to satisfy the probe. Their original runner scripts are reused with only the relocated project/repository paths adjusted; outer `run.ps1` bounds the Summary process and binds all files to checkout SHA. Their project references point at the current integration production sources.

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

The supplementary screenshots include native `PrintWindow` at the actual HWND's dimensions and complete primary-desktop `BitBlt` with the tested HWND verified foreground, without crop/resize/upscale. The author probes use WPF `RenderTargetBitmap` of their actual displayed windows; these are identified separately and do not prove desktop compositor rendering. `evidence-manifest.json` binds every raw file's SHA256/size to checkout and relevant Git subtree identities. Supplementary JSON also describes native capture dimensions/DPI/hash. Captures use `CreateNew`; all per-case PNG receipts are revalidated after the last case to reject cross-case overwrites. The runner's actual display dimensions are recorded, rather than upscaled to a requested resolution.

Original probes use actual control properties and WPF RoutedEvent Click/Key. Focus checks inspect actual keyboard focus. The new work-area cases additionally use native SendInput mouse clicks and hit tests. Native keyboard, IME, other DPI values, accessibility, host-menu wiring and production financial compliance are not asserted.

The first phase retained a 1024×768 BookTools work-area finding. The authorized follow-up fixes only that module's WPF layout: actual monitor/DIP bounds, scrollable content, fixed action footer. New native mouse/hit-test cases pass at real 1024×768 and 1920×1080, both 96 DPI. See `WORKAREA_FIX.md` for the minimal production SHA, current CI and raw originals; the first-phase evidence remains preserved. Other DPI values, native keyboard/IME and multi-monitor movement are still unverified.

## Integration

Cherry-pick only this QA branch's new commits onto the compatible integration baseline. No solution changes are needed: run the three commands above. The workflow's branch filter intentionally stays QA-only; the integration owner can run scripts directly or explicitly adapt their own CI. Recheck `sourceTrees` when combining later production fixes; a result for one SHA does not certify a changed subtree.

Runtime results, original failure diagnostics, evidence links and remaining limits are recorded in `HANDOFF.md`. Compilation by itself is not feature acceptance.
