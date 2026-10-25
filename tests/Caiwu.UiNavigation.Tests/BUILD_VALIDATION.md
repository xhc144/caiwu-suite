# Validation record

2026-10-25, Debian 13 x64, official .NET SDK 10.0.402 / runtime 10.0.13. Production baseline: `6a4683955267306f8eb9544635560d214b5921f9` (`codex/windows-revalidation`), rechecked with `git ls-remote` after implementing the probes.

Executed from the repository worktree:

```sh
source /workspace/caiwu-tooling/env.sh
dotnet build tests/Caiwu.UiNavigation.Tests/Caiwu.UiNavigation.Tests.csproj -c Release --nologo
dotnet build tests/Caiwu.UiNavigation.Tests/Caiwu.UiNavigation.Tests.csproj -c Release --no-restore --nologo
git diff --check
```

The writable HOME/CLI/XDG/NuGet paths are local environment setup, not project requirements. No credentials or extra NuGet configuration were required. Restore used the existing projects and the official WindowsDesktop reference pack.

Results: initial restore/build succeeded; final build after the source review succeeded in 2.47 seconds, **0 warnings / 0 errors**. `git diff --check` passed. The only source additions are inside `tests/Caiwu.UiNavigation.Tests/`.

**Windows runtime: NOT RUN.** WPF/common file dialogs cannot execute on this Linux host. The Windows PowerShell runner has not been executed here either. No `navigation-results.json` or screenshots are supplied as if they were runtime evidence. These checks do not prove either regression was reproduced or fixed. Acceptance must run `run.ps1` on actual Windows and inspect its exact case statuses and observations.
