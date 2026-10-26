# 桌面壳与安装包（M21）

功能：

- 默认 `文档/财务账套`；`CAIWU_DATA_DIR` 优先。文件菜单可选择可写的新目录，确认后重启；取消未保存关闭时取消切换。仅更改启动位置，不搬迁旧账套或备份。
- 单实例唤醒、窗口位置/大小/最大化状态保存和多屏可见区域校正。
- 随机令牌/端口的本地服务；正常退出必须由关闭请求后的 exit 0 确认，之后才保存配置或切换目录/重启。默认等 35 秒，超时不强杀，可继续等待；非零、信号或强制终止均提示退出未完成。显式强制/异常退出使用退出码 1，不提交设置、不重启。失败后业务会话不可继续，可能遗留的共享数据目录锁须由维护人员处理，桌面不会删除锁。中文恢复提示、限大小轮换的本地去敏事件日志。
- 兼容 `caiwuDesktop.print` / `printToPdf`；隔离打印窗禁脚本及远程加载，PDF 先选保存位置。新增可选 `caiwuDesktopHost` 提供目录设置及文件选择，类型见 `src/bridge.ts`。
- 中文 NSIS、可选安装目录、快捷方式、自制图标；数据目录与安装树双向隔离并解析 books/备份 junction。安装/卸载先保存退出，安装树中发现旧账套、备份、配置或链接时停止；正常卸载保留外部用户数据。打包检查 web、server、preload、SQLite 文件完整性。
- 私有 Windows workflow：冻结安装、全仓检查、Electron SQLite 重编译、NSIS 构建及独立安装/覆盖/卸载回归；回归中的 0.0.9 是同一代码构建的测试旧版本。

配置和日志默认在用户应用数据目录 `caiwu-desktop/`。独立测试可设置绝对路径 `CAIWU_DESKTOP_USER_DATA_DIR`，不得指向日常使用的配置目录。

Windows x64 手动打包前，在 `app/` 执行 `node apps/desktop/build/prepare-native.mjs`、`pnpm -C apps/desktop exec electron-builder install-app-deps --platform win32 --arch x64`，再 `pnpm -C apps/desktop exec electron-builder --win nsis --x64 --publish never`。SQLite 13.0.3 使用 N-API；准备脚本移除本次安装的主机 prebuild，确保入包和实际加载的是 Electron 重编译结果。

运行：在 `app/` 执行 `pnpm desktop:build`、`pnpm -C apps/desktop start`。桌面自有测试由 `pnpm exec vitest run apps/desktop` 执行。真实 Electron 回归需先运行 `pnpm exec tsx apps/desktop/qa/prepare-fixture.ts <全新绝对临时目录>`，设置 `CAIWU_DESKTOP_QA_FIXTURE` 为该目录，再运行 `pnpm exec playwright test --config apps/desktop/playwright.config.ts`；需要 Electron 本体和桌面显示。Node 夹具须在重编译 Electron ABI 之前创建。

未完成：

- 旧账套自动迁移、已发布历史安装包的升级兼容及回滚机制。
- Windows 实机原生对话框、系统打印机、中文字体/横向版面、多屏和安装界面的人工试用；脚本中的保存对话框使用测试适配器。
- 所有业务表单接入标准 `beforeunload`；本任务只提供桌面支持。
- 代码签名、受信任分发渠道和自动更新；没有配置更新服务器或下载执行机制。
