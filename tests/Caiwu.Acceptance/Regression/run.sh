#!/usr/bin/env bash
set -euo pipefail
acceptance_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$acceptance_root/../.." && pwd)"
export DOTNET_CLI_HOME="${CAIWU_ACCEPTANCE_CACHE:-/tmp/caiwu-acceptance-cache}/cli"
export XDG_RUNTIME_DIR="${CAIWU_ACCEPTANCE_CACHE:-/tmp/caiwu-acceptance-cache}/runtime"
export XDG_DATA_HOME="${CAIWU_ACCEPTANCE_CACHE:-/tmp/caiwu-acceptance-cache}/data"
export XDG_CONFIG_HOME="${CAIWU_ACCEPTANCE_CACHE:-/tmp/caiwu-acceptance-cache}/config"
export NUGET_PACKAGES="${CAIWU_ACCEPTANCE_CACHE:-/tmp/caiwu-acceptance-cache}/packages"
export NUGET_HTTP_CACHE_PATH="${CAIWU_ACCEPTANCE_CACHE:-/tmp/caiwu-acceptance-cache}/http"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
mkdir -p "$DOTNET_CLI_HOME" "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$NUGET_PACKAGES" "$NUGET_HTTP_CACHE_PATH"
chmod 700 "$XDG_RUNTIME_DIR"
cd "$repo_root"
export CAIWU_ACCEPTANCE_CHECKOUT_COMMIT="$(git rev-parse HEAD)"
export CAIWU_ACCEPTANCE_SOURCE_TREE="$(git rev-parse HEAD:src)"
dotnet_bin="${CAIWU_ACCEPTANCE_DOTNET:-dotnet}"
"$dotnet_bin" build "$acceptance_root/Regression/Caiwu.Acceptance.Regression.csproj" -c Release --artifacts-path "$acceptance_root/.build" --nologo
exec "$dotnet_bin" "$acceptance_root/.build/bin/Caiwu.Acceptance.Regression/release/Caiwu.Acceptance.Regression.dll" "$@"
