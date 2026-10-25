# WPF visual module handoff — 2026-10-25 10:14 UTC

Current deliverable: native WPF visual redesign with the font/style inheritance, report-column and capture refinements. Private draft [PR 14](https://github.com/xhc144/caiwu-suite/pull/14), branch `codex/modern-visuals`. This record supersedes the earlier `7a845d4` evidence.

Validated code commit: `98a43e01bb1296abd8968bef50c40a476d9377ad`.
Behavior-owning base: `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5` from `codex/windows-revalidation`.
Validated `src` tree: `da2fb244f2bac779501fa07ac63e45f7c3c28dce`.
The subsequent handoff-only commit changes Markdown, not that source tree, and does not need another rendering run.

## LedgerGrid supplement — 2026-10-25 10:26 UTC

The earlier 70-cell check covered ReportGrid only. Root requested one equivalent LedgerGrid check, so a test-only supplement was added at `8d9959a0a714b73892b9f953b59bd8a3d89dde9b`; application `src` remains exactly `da2fb244f2bac779501fa07ac63e45f7c3c28dce`, identical to the validated visual implementation above. No visual or behavior code was changed for this supplement.

[Windows run 40184502213](https://github.com/xhc144/caiwu-suite/actions/runs/40184502213) is **success**. [Native evidence 12595626696](https://github.com/xhc144/caiwu-suite/actions/runs/40184502213/artifacts/12595626696) includes the original ledger PNG and `visual-review.json` with `ledgerCellMeasurements`. [Regression evidence 12595217863](https://github.com/xhc144/caiwu-suite/actions/runs/40184502213/artifacts/12595217863) contains the existing WPF/navigation results.

- Covered the opening row and all three ordinary posted rows: 4 rows × 7 columns = 28 cell/header boundary measurements.
- Cell/header X error and width error: maximum **0**.
- Covered all 12 debit/credit/balance content boxes: full-width right alignment, expected right-edge error **0**, ordinary/opening right-edge difference **0**.
- Balance content boxes all have X 1690, width 128, right edge **1818 relative to LedgerGrid** at 96 DPI, displaying `100,000.00`, `90,000.00`, `88,800.00`, `108,800.00`.
- The source ledger PNG was also viewed at original resolution. This check did not find an opening-versus-ordinary amount-column displacement in this build. No visual fix was made or inferred from thumbnail appearance.

Root can retain the already delivered 98a43e0 visual version and Library images; the application tree is unchanged. Cherry-picking the single test commit is optional if the root wants this case in the integrated visual runner. Future module visuals remain for the integration acceptance task, not this phase.

## Actual evidence

[Isolated Windows run 40183636004](https://github.com/xhc144/caiwu-suite/actions/runs/40183636004): **success**, exact validated code commit.

- [Original PNG artifact 12595018371](https://github.com/xhc144/caiwu-suite/actions/runs/40183636004/artifacts/12595018371): six real 1920×1080/96-DPI full native desktop BitBlt captures. For the requested four views use `02-vouchers.png`, `03-voucher-editor.png`, `05-bank-ledger.png`, `06-reports.png`. All four were downloaded and visually inspected; every one of the six PNG hashes matches the manifest. No crop, resize, upscale, black padding or generated mockup.
- That artifact's `visual-review.json` records ten actual visual/runtime checks, actual rendered glyph families/weight/colour and all 70 body-cell/header measurements. Chinese body glyphs are **Microsoft YaHei UI**, numeric glyphs **Segoe UI Variable**, body **Normal / #FF202938**. These are actual GlyphRun typefaces, not just declared font names. No font bytes or system font settings were changed.
- All seven report rows, including 1403/3001/5001, have **0-pixel** cell/header X and width error across all ten columns. Actual amount content occupies the column width and aligns right. Amounts and displayed totals use grouping, e.g. `100,000.00` and `108,800.00`.
- [Interaction evidence 12595500778](https://github.com/xhc144/caiwu-suite/actions/runs/40183636004/artifacts/12595500778): same native metadata plus all existing eight WPF regressions and both new-book/report navigation cases PASS; zero failed or blocked. Real invalid/busy/stale saves retaining input, rapid double-save protection, read-only drill-through and cancellation/context preservation were exercised with actual WPF/SQLite.
- .NET SDK 10.0.402: Desktop, VisualReview and the full solution Release cross-build with warnings treated as errors pass. `node tests/Caiwu.VisualReview/verify-xaml.mjs` and `git diff --check` pass. Linux compilation is distinct from Windows runtime evidence.

PNG SHA256s:

| File | SHA256 |
|---|---|
| `02-vouchers.png` | `8501c2f4e361e76d23941013a596cea9f1d4924f4cc3f2f37c5a98c432d7ace5` |
| `03-voucher-editor.png` | `6ef7f417ef74a23a29fd1f338d1f58035cdc8467a238571ae90986d54bbc734b` |
| `05-bank-ledger.png` | `f56cc6486e5e408621d0616baf13a6ba5868f5ed37593aea6113aa272b442ab8` |
| `06-reports.png` | `abf772d5d12c7e89571e631bd66ec905db0e07bcfc15ef44a594ee0bf5acd45a` |

## Integration

For an integration that already has `7a845d4`, apply the refinements and independent capture runner:

```sh
git fetch origin codex/modern-visuals
git cherry-pick 7a845d4e637326c28774740580b675fcc5d240c4..98a43e01bb1296abd8968bef50c40a476d9377ad
```

For the whole module, replace the range start with `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5`. Preserve the integration branch's newer behavior code and any newer binding if there is an XAML conflict. Existing OpeningGrid PropertyChanged bindings and every original name, automation ID, operation label, handler and WriteOperation guard are retained.

Owned files and roles:

| Path | Purpose and boundary |
|---|---|
| `src/Caiwu.Desktop/Themes/Modern.xaml` | Complete native Fluent Light resources, explicit native base styles, complete Button/Tab/Cell templates, neutral body typography, focus/hover/disabled/selection and amount presentation. Runtime verified. |
| `src/Caiwu.Desktop/Themes/ReportGridPresentation.cs` | Read-only display decorator: typed amount metadata, original binding paths/modes, N2 grouping, amount column/header styles and totals; no accounting writes or export/model changes. |
| `src/Caiwu.Desktop/App.xaml` | Theme resource merge. |
| `src/Caiwu.Desktop/MainWindow.xaml` | Native shell, surfaces/navigation/action hierarchy; original behavior bindings/handlers retained. |
| `src/Caiwu.Desktop/Dialogs/*.xaml` | Voucher/report visuals and amount editing styles. ReportGrid opts into GroupAmounts and disables column virtualization while retaining row virtualization. |
| `tests/Caiwu.VisualReview/**` | Bounded real Windows capture/check runner, source boundary guard and evidence record; outside solution, WinExe, no added NuGet package. |
| `.github/workflows/visual-capture.yml` | Explicitly authorized ownership exception: private visual branch-only job, pinned existing actions, contents read-only, immediate native PNG upload followed by existing narrow WPF/navigation tests. No installer/publish step or secret. |

No existing code-behind, event signatures, Contracts, Core, SQLite, Controls implementation, solution, existing workflow, installer or delivery hold was modified. This is ready for root integration into `codex/sprint-integration-2`, not a merge or whole-product accounting acceptance claim.

## Findings and repaired attempts

1. The local implicit Button style suppressed Fluent. Complete self-authored templates and explicit .NET10 native named style inheritance fix the legacy rectangles; complete `Fluent.Light.xaml` supplies the missing colour/surface resources.
2. Selected TabItem foreground/weight had propagated to its page, making body text blue and semi-bold. Header-only setters plus normal neutral cells fix that leak. Actual glyphs confirm YaHei UI/Segoe; no SimSun/Times font fallback was found in the sampled body/amount cells.
3. Report cells needed complete full-column content layout, not only a right-alignment flag. The cell template now honors padding/stretch and amount columns use typed metadata, grouping and consistent width. Every row's actual X/width and content width are checked, rather than just header widths.
4. Renaming Generate broke an existing navigation probe. Restored familiar operation labels, added the source guard, and reran both navigation cases successfully.
5. Early normal-window capture was clamped by a small desktop. Testing/applying a supported native display mode fixed dimensions without upscaling.
6. A later full-desktop report PNG exposed a maximize/compositor transition despite a green capture process; the old PrintWindow backup also failed the new black-frame guard. The final runner uses one foreground desktop BitBlt path with repeated render/message pumping, DwmFlush, stable client/maximized bounds and black-region rejection. It preserves all ten checks, uploads images early and avoids the redundant unreliable capture path. The current six PNGs are the valid set; do not reuse intermediate black/transitional captures.

Framework sources: [official WPF Fluent documentation](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net100), [official .NET10 Fluent Light resources](https://github.com/dotnet/wpf/blob/v10.0.0/src/Microsoft.DotNet.Wpf/src/Themes/PresentationFramework.Fluent/Themes/Fluent.Light.xaml).

## Remaining boundaries

- Root must integrate and validate the combined application. Earlier full runs `40180397486`/`40180961028` had Delivery file-sharing/backup failures and MutationWindows timeouts owned elsewhere. Keep `DELIVERY_PAUSED`; this isolated visual pass does not clear that hold.
- Actual evidence is 96 DPI. Physical Chinese IME, screen reader, High Contrast and higher-DPI manual certification remain outside the executed checks. Existing keyboard/editing routes and native automation peers are preserved and the specific scripted checks pass.
- No current visual-module action is denied, pending or uncertain. Push and draft PR succeeded. Only synthetic books were created. No pre-mounted book library, original installer/software/SQL/object material, original-derived catalog, permissions or credentials were modified/uploaded.
