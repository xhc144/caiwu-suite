# Release candidate stage, 2026-10-25

Branch: `codex/release-candidate`. This stage ends by **12:15 UTC**. The delivery hold remains in place. No installer, distribution ZIP, Release, signing material, credentials or production update feed is created by the preparatory workflow.

## Concrete integration

- Baseline: Integration2 `10e38ff65313aae5106a6b55c42790d47345b8fb`. Its focused native Windows run [40186708406](https://github.com/xhc144/caiwu-suite/actions/runs/40186708406) passed. This does not certify the later managed App composition.
- Unmodified author code: Managed modules `9ca1deb40f9215817a0433572460183d3ba82566`; its exact required ReportDesigner dependency `03ee6dac47a7cc1c61f303f3c5e214245f87017d`. Existing module implementations, Core, Contracts, Storage and MainWindow behavior have no stage-authored changes.
- `Caiwu.Delivery.Host` references Delivery.Modules without a circular reference. Its install command supplies all four native codecs. `launch` selects the reviewed managed handoff only when the installed manifest already advertises that contract; it never reacquires the child's leases. The default manifest command still advertises false.
- `Prepare-WindowsCandidate.ps1` performs locked RID restore and self-contained publish from a clean commit, checks cleanliness again after each operation and records exact source identity and file hashes. It creates no installer/archive and can run while delivery is paused. Desktop and host RID locks are separately frozen under `packaging-next/locks`; source owners' lock files are not changed.
- `build.py` keeps its early pause gate and now uses the codec-composing host for the installer engine and installed launcher. It rechecks source identity and the pause marker before NSIS. There is no new bypass.

## Actual stage checks so far

Linux SDK 10.0.402 was downloaded from the repository's pinned official URL and its SHA512 matched `docs/sdk-metadata.json`. Cross-publish of the real WPF win-x64 self-contained graph completed. The independent helper subprocess test passed busy-lease rejection, successful codec-aware summary upgrade, source SQLite/summary/global-directory preservation, complete pre-upgrade summary bundle and uninstall retention. The author's real four-attachment/identity integration also passed. These are component tests and Linux cross-build evidence, not native installed Windows App acceptance.

## Remaining gates

1. Receive Feature owner's final authenticated Managed App SHA, integrate only reviewed author changes and refresh Desktop locks explicitly if its graph changes.
2. Run source-bound Windows preparation and independent authenticated test host. Install/run acceptance must use the installed executable from a non-source working directory and normal login with isolated synthetic identities.
3. Root independently reviews the exact composition and explicitly authorizes an **internal validation candidate** before any new installer/ZIP is generated. This stage cannot remove `DELIVERY_PAUSED.md` on its own.
4. Native installation/upgrade/uninstall, real installed save/review/post/book queries, menu entry points, backup/restore and complete data/attachment retention remain unverified until their actual reports exist. No successful component count substitutes for these flows.

Proposed commands (preparation does not wait for installer authorization):

```powershell
./packaging-next/Prepare-WindowsCandidate.ps1 -OutputDirectory artifacts/candidate-preparation
dotnet run --project tests/Caiwu.Delivery.Tests/HostIntegration -c Release -- artifacts/candidate-preparation/helper/Caiwu.Delivery.Host.exe artifacts/candidate-preparation/host-integration-windows.json
```

The source-bound preparatory workflow is `.github/workflows/windows-candidate-validation.yml`. Its uploaded artifact contains JSON/PNG/log evidence only, without payload binaries or identity stores.
