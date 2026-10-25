#!/usr/bin/env bash
set -euo pipefail
caiwu_repo="$(git rev-parse --show-toplevel)"
caiwu_validation="$(mktemp -d /tmp/caiwu-managed-validation-XXXXXXXX)"
git -C "$caiwu_repo" archive HEAD | tar -x -C "$caiwu_validation"
tar -C "$caiwu_repo" --exclude=bin --exclude=obj -cf - packaging-next/src/Caiwu.Delivery tests/Caiwu.Delivery.Tests | tar -xf - -C "$caiwu_validation"
for caiwu_pair in \
  dcda051a0c9ee364ccff4c2b4c7085f446fac39d:src/Caiwu.Summaries \
  cb71350b2b19067e7a8704b74985d8cf0f15e1aa:src/Caiwu.Nonprofit.Reporting \
  af0d0e34ab9963fc91cabb8a58aed558b34390f0:src/Caiwu.Costing \
  1957435365390756fd8267937fd0ec408b1e498f:src/Caiwu.Operators \
  03ee6dac47a7cc1c61f303f3c5e214245f87017d:src/Caiwu.ReportDesigner; do
  git -C "$caiwu_repo" cat-file -e "${caiwu_pair%%:*}^{commit}" 2>/dev/null || git -C "$caiwu_repo" fetch origin "${caiwu_pair%%:*}"
  git -C "$caiwu_repo" archive "${caiwu_pair%%:*}" "${caiwu_pair#*:}" | tar -x -C "$caiwu_validation"
done
export CAIWU_DOTNET_ROOT="${CAIWU_DOTNET_ROOT:-$caiwu_repo/.tools/dotnet}"
cd "$caiwu_validation"
./tools/dotnet-local.sh run --project tests/Caiwu.Delivery.Tests/ModuleIntegration -c Release -p:RestoreLockedMode=true -- "$caiwu_validation/module-integration.json"
printf '%s\n' "$caiwu_validation"
