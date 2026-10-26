# Codex 云环境配置

在 Codex 的环境设置里：

- **Node 版本**：22.12 及以上（推荐 24 LTS）
- **Setup script**（有网络时执行一次，之后任务执行阶段通常没有网络）：

```bash
cd app
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable || npm install -g pnpm@10.28.0   # Node 25 起不再自带 corepack
export ELECTRON_SKIP_BINARY_DOWNLOAD=1           # 云端不运行桌面窗口，不用下载 Electron 本体
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
```

- **Maintenance script**（环境有这一项时填；复用缓存容器时执行，锁文件变了也能装上新依赖）：

```bash
cd app
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm install --frozen-lockfile
```

- **验收命令**：`cd app && pnpm check`

如果环境里已经有 Chromium、但版本和 Playwright 不匹配，可以设置环境变量
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome`，跳过 `playwright install`。
