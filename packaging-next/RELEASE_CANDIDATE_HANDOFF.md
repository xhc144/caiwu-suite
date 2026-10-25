# Release candidate stage, 2026-10-25

Branch: `codex/release-candidate`. This stage ends by **12:15 UTC**. The delivery hold remains in place. No installer, distribution ZIP, Release, signing material, credentials or production update feed is created by the preparatory workflow.

## Concrete integration

- Baseline: Integration2 `10e38ff65313aae5106a6b55c42790d47345b8fb`. Its focused native Windows run [40186708406](https://github.com/xhc144/caiwu-suite/actions/runs/40186708406) passed. This does not certify the later managed App composition.
- Unmodified author code: Managed modules `9ca1deb40f9215817a0433572460183d3ba82566`; its exact required ReportDesigner dependency `03ee6dac47a7cc1c61f303f3c5e214245f87017d`. Existing module implementations, Core, Contracts, Storage and MainWindow behavior have no stage-authored changes.
- `Caiwu.Delivery.Host` references Delivery.Modules without a circular reference. Its install command supplies all four native codecs. `launch` selects the reviewed managed handoff only when the installed manifest already advertises that contract; it never reacquires the child's leases. The default manifest command still advertises false.
- `Prepare-WindowsCandidate.ps1` performs locked RID restore and self-contained publish from a clean commit, checks cleanliness again after each operation and records exact source identity and file hashes. It creates no installer/archive and can run while delivery is paused. Desktop and host RID locks are separately frozen under `packaging-next/locks`; source owners' lock files are not changed.
- `build.py` keeps its early pause gate and now uses the codec-composing host for the installer engine and installed launcher. It rechecks source identity and the pause marker before NSIS. There is no new bypass.
- Managed App author code `e407e0b827c345ad2415ad0cb4634d0fc5f534a2` is imported unchanged. Later Feature handoff `9ec65f84ee471dcda31378e8c49901d35f3a4220` has the same production code. App opens the verified child-owned session before global identity access. Delivery is compiled as a library only in the publish graph, eliminating the two RID/non-RID executable apphost/runtimeconfig outputs; ordinary component CLI tests retain their executable entry.

## Internal QA authorization and pipeline

Root explicitly adjusted the initial stricter ordering at 2026-10-25 11:04 UTC: isolated CI may generate **INTERNAL-UNVALIDATED** synthetic validation installers while retaining the independent delivery pause. This is not user-delivery approval. `Build-InternalQa.ps1` enforces exact clean commit, locked RID graph, pinned NSIS, an `internal-qa/<version>` output root, internal file/report classification, and no production publishing or update-feed action. The independent manifest tool is compiled only in `tests/Caiwu.Delivery.Tests/InstalledDesktop` and is never in the payload. It enables the real composed managed capability for internal tests; it is not an authentication switch or release-ready flag.

`.github/workflows/windows-internal-qa.yml` builds two private CI candidates, installs into a temporary current-user Programs path containing Chinese and spaces, and runs an external controller from a non-source working directory. Only the installed launcher/App is the product under test. The controller uses ordinary identity APIs to pre-create unique synthetic accounts, then drives the actual product login, new-book dialog, voucher grid, separate reviewer login, posting, ledger page, summary/cost/book-copy menus and trusted complete backup/restore. The harness tests both actual held leases, busy upgrade refusal, idle native-codec upgrade, normal upgraded login/open and uninstall retention. Logs/PNGs/partial JSON are retained on any failure. It does not restore the removed product smoke switch.

## Actual stage checks so far

Linux SDK 10.0.402 was downloaded from the repository's pinned official URL and its SHA512 matched `docs/sdk-metadata.json`. Cross-publish of the real WPF win-x64 self-contained graph completed. The independent helper subprocess test passed busy-lease rejection, successful codec-aware summary upgrade, source SQLite/summary/global-directory preservation, complete pre-upgrade summary bundle and uninstall retention. The author's real four-attachment/identity integration also passed. These are component tests and Linux cross-build evidence, not native installed Windows App acceptance.

On clean source `6f56a678d8cd2097217b46fe3e9ea2f8a09a6e91`, [Windows run40187152067](https://github.com/xhc144/caiwu-suite/actions/runs/40187152067) passed locked self-contained publish, actual self-contained helper subprocess protection checks and the four-attachment/identity integration. Its old Feature window host then failed menu policy assertions and its final watchdog; the run is **failed**. Artifact12596750458 SHA256 `4d69aa75b1ffbed63c5c26872c84d6ea5fd877c0355eb4891f8c4be692e11216` was downloaded through the supported GitHub artifact tool and verified. Raw direct `gh run download` had a known HTTP403 redirect failure; that was not an upload or approval rejection. Selected synthetic result JSON and failing stdout are retained under `evidence/release-candidate`.

The old broad Feature window host is no longer repeated by the narrowly named preparation workflow. Its failure is not waived: module/UI QA remains with its owners, and this stage's separate native workflow must prove actual installed normal App behavior. The relevant full Delivery component regression ran once after the publish-role change: 163 passed, 0 failed, 3 explicit POSIX platform skips; it does not certify native installation.

## Remaining gates

1. Preserve exact author provenance and accept later reviewed fixes only; the imported final managed production tree is e407e0b.
2. Finish source-bound Windows preparation and actual installed App validation. The current code/pipeline is not counted as a successful runtime result.
3. Internal QA generation is authorized as described above; **user delivery remains paused** pending exact-combination independent review and root's final approval. This stage cannot remove `DELIVERY_PAUSED.md` on its own.
4. Native installation/upgrade/uninstall, real installed save/review/post/book queries, menu entry points, backup/restore and complete data/attachment retention remain unverified until their actual reports exist. No successful component count substitutes for these flows.

Proposed commands (preparation does not wait for installer authorization):

```powershell
./packaging-next/Prepare-WindowsCandidate.ps1 -OutputDirectory artifacts/candidate-preparation
dotnet run --project tests/Caiwu.Delivery.Tests/HostIntegration -c Release -- artifacts/candidate-preparation/helper/Caiwu.Delivery.Host.exe artifacts/candidate-preparation/host-integration-windows.json
```

The source-bound preparatory workflow is `.github/workflows/windows-candidate-validation.yml`. Its uploaded artifact contains JSON/PNG/log evidence only, without payload binaries or identity stores.
