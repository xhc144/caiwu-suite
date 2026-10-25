#!/usr/bin/env bash
set -euo pipefail
acceptance_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
review_root="${CAIWU_REVIEW_SOURCE_ROOT:-$(cd "$acceptance_root/../.." && pwd)}"
export DOTNET_CLI_HOME=/tmp/caiwu-acceptance-cache/cli
export XDG_RUNTIME_DIR=/tmp/caiwu-acceptance-cache/runtime
export XDG_DATA_HOME=/tmp/caiwu-acceptance-cache/data
export XDG_CONFIG_HOME=/tmp/caiwu-acceptance-cache/config
export NUGET_PACKAGES=/tmp/caiwu-acceptance-cache/packages
export NUGET_HTTP_CACHE_PATH=/tmp/caiwu-acceptance-cache/http
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false
mkdir -p "$DOTNET_CLI_HOME" "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$NUGET_PACKAGES" "$NUGET_HTTP_CACHE_PATH"
chmod 700 "$XDG_RUNTIME_DIR"
git -C "$review_root" diff --quiet HEAD -- src || { echo 'Reviewed production sources have local edits; refusing ambiguous source identity.' >&2; exit 2; }
export CAIWU_REVIEW_CHECKOUT_COMMIT="$(git -C "$review_root" rev-parse HEAD)"
export CAIWU_REVIEW_CORE_BLOB="$(git -C "$review_root" rev-parse HEAD:src/Caiwu.Core/LedgerService.cs)"
export CAIWU_REVIEW_CONTRACTS_TREE="$(git -C "$review_root" rev-parse HEAD:src/Caiwu.Contracts)"
export CAIWU_REVIEW_SQLITE_TREE="$(git -C "$review_root" rev-parse HEAD:src/Caiwu.Persistence.Sqlite)"
[[ "$CAIWU_REVIEW_CORE_BLOB" == 8af6023ced9e53bf8e4a8fa3f9bb216bce34917e ]] || { echo 'Core source does not match reviewed fix 53fe0f2.' >&2; exit 2; }
[[ "$CAIWU_REVIEW_CONTRACTS_TREE" == c88d36ff051dd784e92d96e66fd8ab37d0100adc ]] || { echo 'Contracts do not match the reviewed integration token contract.' >&2; exit 2; }
dotnet_bin="${CAIWU_ACCEPTANCE_DOTNET:-dotnet}"
"$dotnet_bin" build "$acceptance_root/Revalidation53fe/Caiwu.Acceptance.Revalidation53fe.csproj" -c Release --artifacts-path "$acceptance_root/.build/revalidation53fe" "-p:ReviewedSourceRoot=$review_root" --nologo
exec "$dotnet_bin" "$acceptance_root/.build/revalidation53fe/bin/Caiwu.Acceptance.Revalidation53fe/release/Caiwu.Acceptance.Revalidation53fe.dll" "${1:-$acceptance_root/evidence/revalidation-53fe0f2.json}"
