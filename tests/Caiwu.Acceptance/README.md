# Independent acceptance

Historical baseline production commit: `037a07585078d4dfcd443a2cc4a237c88aed07a0`.

Only this directory and `docs/acceptance` are owned by this review. Production code, Contracts, Desktop, root solution, workflows and original commercial packages are untouched.

- `Regression/`: console executable referencing actual Core/SQLite projects and linking actual Desktop session/row models. 18 checks; baseline has 14 pass and 4 fail, exit 1. `ACC-005` classifies an actual busy exception against the baseline editor catch expression; this is explicitly not WPF execution and must be retested with the actual WPF handler after any fix.
- `Wpf/`: actual WPF classes/resources, scripted controls/routed events and real SQLite; eight probes. Cross-compiled on Linux only. Not executed in this environment. Routed events/reflection plus one synthetic native mouse double-click; no physical keyboard, IME or native file-dialog automation.
- `evidence/ci/`: original Windows CI screenshots, metadata, TRX and package file manifests; provenance links artifact/run/SHA/hashes. ZIPs and synthetic databases are locally ignored. Only self-authored program artifacts were downloaded; no commercial EXE was downloaded or executed.
- `evidence/regression-037a075.json`: independent actual baseline run results, runtime/culture and source identity.
- `.build/` and `evidence/runtime/`: ignored build/generated execution outputs.

Linux/Windows console run:

```sh
CAIWU_ACCEPTANCE_DOTNET=/absolute/path/to/dotnet tests/Caiwu.Acceptance/Regression/run.sh
```

On Windows PowerShell, the console runner can be invoked with `dotnet run --project tests/Caiwu.Acceptance/Regression/Caiwu.Acceptance.Regression.csproj -c Release -- tests/Caiwu.Acceptance/evidence/runtime/regression.json`. Set `CAIWU_ACCEPTANCE_CHECKOUT_COMMIT` and `CAIWU_ACCEPTANCE_SOURCE_TREE` to the reviewed source identities if using that direct command. Baseline identity in JSON is an origin label; checkout/source-tree identities state what was actually tested.

Windows WPF run:

```powershell
./tests/Caiwu.Acceptance/Wpf/run.ps1
```

Requires an actual Windows desktop/WPF runtime, PowerShell 7 and .NET SDK 10.0.402. Does not modify the existing solution or CI workflow. It must be invoked explicitly; current packaging cannot automatically run this separate console harness. Read `wpf-results.json` and review new PNGs; a passing layout-width assertion is not a visual quality sign-off.

Full Chinese findings, exact repros, severity and coverage limits: [acceptance report](../../docs/acceptance/037a075-independent-acceptance.md).

Windows probe coverage/CI handoff and successful artifact download path: [probe handoff](../../docs/acceptance/windows-probe-handoff.md).

Targeted Core repair 53fe0f2: `Revalidation53fe/` references the reviewed production projects and captures edit tokens only at editor opening. Actual independent result: 23 PASS / 0 FAIL; [report](../../docs/acceptance/53fe0f2-core-revalidation.md). Windows stale-editor UI is the eighth WPF probe and is not yet executed here.
