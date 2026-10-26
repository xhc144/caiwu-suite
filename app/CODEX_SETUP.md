# Codex 云环境配置

在 Codex 的环境设置里：

- **Node 版本**：24（必须）。Node 22 下 Playwright 加载用到 exceljs 的 E2E 文件时会报 `ERR_VM_MODULE_LINK_FAILURE`
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

浏览器优先用 `playwright install` 装的版本。环境里已有 Chromium 时也可以设置
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome` 跳过安装，但版本差太多时，打印事件相关的 E2E 可能失败。

系统没设 UTF-8 locale 时，`playwright.config.ts` 会自动给浏览器加 `LANG=C.UTF-8`，否则中文下载文件名会变成 "download"。
