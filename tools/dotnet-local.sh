#!/usr/bin/env bash
set -euo pipefail
caiwu_project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
caiwu_sdk_root="${CAIWU_DOTNET_ROOT:-$caiwu_project_root/.tools/dotnet}"
export DOTNET_ROOT="$caiwu_sdk_root"
export DOTNET_HOST_PATH="$caiwu_sdk_root/dotnet"
export DOTNET_CLI_HOME="$caiwu_project_root/.tools/cli"
export XDG_RUNTIME_DIR="$caiwu_project_root/.tools/runtime"
export XDG_DATA_HOME="$caiwu_project_root/.tools/data"
export XDG_CONFIG_HOME="$caiwu_project_root/.tools/config"
export NUGET_PACKAGES="$caiwu_project_root/.tools/nuget"
export NUGET_HTTP_CACHE_PATH="$caiwu_project_root/.tools/nuget-http"
export NUGET_PLUGINS_CACHE_PATH="$caiwu_project_root/.tools/nuget-plugins"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
mkdir -p "$DOTNET_CLI_HOME" "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$NUGET_PACKAGES" "$NUGET_HTTP_CACHE_PATH" "$NUGET_PLUGINS_CACHE_PATH"
chmod 700 "$XDG_RUNTIME_DIR"
exec "$caiwu_sdk_root/dotnet" "$@"
