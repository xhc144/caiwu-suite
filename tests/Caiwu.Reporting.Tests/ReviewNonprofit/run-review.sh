#!/usr/bin/env bash
set -euo pipefail
review_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
nonprofit_root=$(cd -- "${1:?Usage: run-review.sh /path/to/nonprofit-38533de}" && pwd)
expected_commit=38533de209000ee57afb46f7dc907e6f591c774f
if [[ $(git -C "$nonprofit_root" rev-parse HEAD) != "$expected_commit" ]]; then
  echo 'Review evidence requires exactly the pinned Nonprofit commit.' >&2
  exit 2
fi
git -C "$nonprofit_root" diff --exit-code HEAD -- src/Caiwu.Nonprofit rules/packages/nonprofit.json
dotnet_command=${DOTNET_COMMAND:-dotnet}
cd -- "$review_dir"
"$dotnet_command" restore Caiwu.Reporting.ReviewNonprofit.csproj --configfile ../NuGet.Config --locked-mode \
  "-p:NonprofitProject=$nonprofit_root/src/Caiwu.Nonprofit/Caiwu.Nonprofit.csproj"
"$dotnet_command" test Caiwu.Reporting.ReviewNonprofit.csproj --no-restore --configuration Release \
  -p:TreatWarningsAsErrors=true "-p:NonprofitProject=$nonprofit_root/src/Caiwu.Nonprofit/Caiwu.Nonprofit.csproj" \
  --logger 'trx;LogFileName=nonprofit-independent-boundaries.trx' --results-directory "$review_dir/.build/results"
