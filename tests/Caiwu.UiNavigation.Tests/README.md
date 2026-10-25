# Windows navigation regression probes

These two independent probes exercise the project's own production WPF windows. They contain no original commercial program data, screenshots, UI catalog, or copied implementation. Production files and the root solution are unchanged.

The source was checked against `codex/windows-revalidation` commit `6a4683955267306f8eb9544635560d214b5921f9`. Both regressions still exist there. This Linux environment can compile the harness for Windows but cannot execute WPF or the Windows common file dialog. **No Windows runtime result is claimed.**

## Assertions

| Case | Actual actions | Required user-visible outcome |
| --- | --- | --- |
| `UI-NAV-NEWBOOK-CANCEL-RETAINS-INPUT` | Main-window New Book menu; enter a distinctive name, enterprise regime, year 2025 and month 7; click the form's actual default button; click Cancel on the same process's actual native Save dialog; inspect the returned form, or reopen New Book if it closed | All four entered values remain; the name can still be edited; the real creation delegate was never called |
| `UI-NAV-REPORT-RETURN-RETAINS-CONTEXT` | Open the actual report center from the main menu with a real SQLite/Core fixture; set dates and a parent account filter; select and scroll to a balance row; double-click into the ledger; select and scroll to a posted voucher; open and close its actual read-only window; return to the balance table | Closing the voucher preserves detail kind/account/date range, selected business row, vertical and horizontal offsets. Returning upward restores those same properties for the parent table. The SQLite snapshot, audit and revision remain unchanged |

The report fixture has 96 extra synthetic accounts and 48 posted synthetic vouchers. Both parent and detail viewports must have nonzero vertical **and** horizontal offsets before assertions. This prevents an empty grid or zero-offset comparison from passing. Row comparisons use account codes and voucher IDs, not object identity. Offsets tolerate at most 0.5 WPF scroll units; row identity and filters must match exactly. Before/after screenshots and measured states are written on real Windows runs, including failures that reach those stages.

Actions use actual routed WPF click/double-click events and programmatic text entry. They are not physical mouse/keyboard or IME tests. The native Cancel helper runs on a background thread because the common file dialog owns a modal loop. It only clicks the visible, enabled `IDCANCEL` button in this process's `#32770` window titled `保存新账套`. Missing dialog/button or timeouts are **BLOCKED**, never PASS. No application other than the test process is clicked.

Reflection is used only for the production backend factory and the existing fixture-load hook (`App.CreateBackend`, `MainWindow.OpenVerificationBook`). It does not invoke navigation handlers, alter dirty flags, inject a fake dialog result, or restore selection/scroll on behalf of production code. Both cases exercise the production callbacks and modal windows. If those two fixture bootstrap hooks change, update the harness explicitly.

## Minimal interaction contract for the repair

New Book may either keep/redisplay the same populated form when Save is cancelled or retain the draft for the next New Book invocation. No extra wizard, autosave or new feature is required. Cancelling the form itself should still close it.

Report navigation may use a visible button whose text identifies returning to the balance table/upper level. If no such button exists, the probe uses the existing report-kind selector and Generate button. Either route must restore the saved parent context. Capture contexts by stable business keys before changing the report, then restore after binding/layout. Closing an unchanged read-only voucher should preserve the current detail context as well; unconditional regeneration alone does not satisfy this contract.

## Build validation on Linux or Windows

Requires the repository's .NET 10 SDK (`global.json`). No additional test package is required. Project references bring in the actual Desktop and backend projects.

```sh
dotnet build tests/Caiwu.UiNavigation.Tests/Caiwu.UiNavigation.Tests.csproj -c Release --nologo
```

Linux cross-compilation downloads the official WindowsDesktop reference pack if absent. It proves compilation only; it cannot establish a regression failure or repair pass.

## Run on actual Windows / connect to Acceptance CI

Run with PowerShell 7 in a Windows desktop session with the .NET 10 SDK/runtime:

```powershell
pwsh -NoProfile -File tests/Caiwu.UiNavigation.Tests/run.ps1 -OutputDirectory artifacts/ui-navigation
```

To run this independent test checkout against a separately checked-out production repair:

```powershell
pwsh -NoProfile -File tests/Caiwu.UiNavigation.Tests/run.ps1 `
  -ReviewedSourceRoot C:\work\windows-revalidation `
  -OutputDirectory C:\work\navigation-evidence
```

The runner compiles directly against that checkout, requires clean tracked and untracked production source paths, records commit/source-tree identities, uses a fresh build directory, bounds runtime to 120 seconds, validates both exact case IDs and statuses, and returns failure for FAIL/BLOCKED/missing results. Results cannot be inferred from a successful build or a zero process exit alone. Increase `-TimeoutSeconds` only for demonstrably slow runners (range 30–300).

Acceptance can invoke that single command after its Windows build and upload `artifacts/ui-navigation` with `if: always()`. No workflow is modified by this change. Do not use `dotnet test` as the execution command: this is an executable WPF probe, not a test-adapter project.

Runtime outputs: `navigation-results.json`, stdout/stderr logs, a uniquely named virtual `.caiwu` fixture, and current-product-only PNGs. Keep them as CI artifacts rather than committing generated files. On a locked/headless Windows session, native dialog interaction or grid layout may be blocked; the process watchdog writes `navigation-timeout.json` when no complete result can be produced. There is no Wine fallback.
