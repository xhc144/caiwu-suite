#!/usr/bin/env bash
set -euo pipefail
# A disposable validation checkout only. Never edits another owner's production files in the working branch.
caiwu_source_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")/../.." rev-parse --show-toplevel)"
caiwu_validation_root="$(mktemp -d /tmp/caiwu-desktop-feature-validation.XXXXXX)"
caiwu_feature_sha="$(git -C "$caiwu_source_root" rev-parse HEAD)"
git -C "$caiwu_source_root" archive "$caiwu_feature_sha" | tar -x -C "$caiwu_validation_root"
git -C "$caiwu_source_root" archive 54871a004a836d76824b2c29959e5b22139f4e86 src/Caiwu.VoucherTools src/Caiwu.VoucherTools.Wpf | tar -x -C "$caiwu_validation_root"
git -C "$caiwu_source_root" archive dcda051a0c9ee364ccff4c2b4c7085f446fac39d src/Caiwu.Summaries | tar -x -C "$caiwu_validation_root"
git -C "$caiwu_source_root" archive 8bbf8428ccd0b656fec83c7a1ede828cd5691442 src/Caiwu.BookTools | tar -x -C "$caiwu_validation_root"
git -C "$caiwu_source_root" archive af0d0e34ab9963fc91cabb8a58aed558b34390f0 src/Caiwu.Costing | tar -x -C "$caiwu_validation_root"
git -C "$caiwu_source_root" archive 1957435365390756fd8267937fd0ec408b1e498f src/Caiwu.Operators | tar -x -C "$caiwu_validation_root"
git -C "$caiwu_source_root" archive cb71350b2b19067e7a8704b74985d8cf0f15e1aa src/Caiwu.Nonprofit.Reporting | tar -x -C "$caiwu_validation_root"
export CAIWU_DOTNET_ROOT="${CAIWU_DOTNET_ROOT:-$caiwu_source_root/.tools/dotnet}"
cd "$caiwu_validation_root"
mkdir -p artifacts/desktop-features
echo "$caiwu_feature_sha" > artifacts/desktop-features/checkout-sha.txt
tools/dotnet-local.sh build src/Caiwu.Desktop/Caiwu.Desktop.csproj -c Release -warnaserror > artifacts/desktop-features/desktop-build.log 2>&1
tools/dotnet-local.sh run --project tests/Caiwu.Desktop.FeatureTests/Logic/Caiwu.Desktop.FeatureTests.csproj -c Release -- artifacts/desktop-features/logic.json > artifacts/desktop-features/logic.log 2>&1
tools/dotnet-local.sh build tests/Caiwu.Desktop.FeatureTests/Windows/Caiwu.Desktop.FeatureTests.Windows.csproj -c Release -warnaserror > artifacts/desktop-features/windows-cross-build.log 2>&1
echo "Validated pinned combination; evidence: $caiwu_validation_root/artifacts/desktop-features"
echo "Windows probe was cross-compiled, not executed. This temporary checkout is retained for review."
