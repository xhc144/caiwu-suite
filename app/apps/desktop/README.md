# 桌面壳与安装包（M21）

功能：

- 默认 `文档/财务账套`；`CAIWU_DATA_DIR` 优先。文件菜单可选择可写的新目录，确认后重启；取消未保存关闭时取消切换。仅更改启动位置，不搬迁旧账套或备份。
- 单实例唤醒、窗口位置/大小/最大化状态保存和多屏可见区域校正。
- 随机令牌/端口的本地服务；正常退出必须由关闭请求后的 exit 0 确认，之后才保存配置或切换目录/重启。默认等 35 秒，超时不强杀，可继续等待；非零、信号或强制终止均提示退出未完成。显式强制/异常退出使用退出码 1，不提交设置、不重启。失败后业务会话不可继续，可能遗留的共享数据目录锁须由维护人员处理，桌面不会删除锁。中文恢复提示、限大小轮换的本地去敏事件日志。
- 兼容 `caiwuDesktop.print` / `printToPdf`；隔离打印窗禁脚本及远程加载，PDF 先选保存位置。新增可选 `caiwuDesktopHost` 提供目录设置及文件选择，类型见 `src/bridge.ts`。
- 中文 NSIS、可选安装目录、快捷方式、自制图标；数据目录与安装树双向隔离并解析 books/备份 junction。安装/卸载先保存退出，安装树中发现旧账套、备份、配置或链接时停止；正常卸载保留外部用户数据。打包检查 web、server、preload、SQLite 文件完整性。
- Windows workflow：Node 24 / pnpm 10.28 冻结安装、全仓检查（零重试）、Electron SQLite 重编译、NSIS 构建及独立安装/覆盖/卸载回归；公开仓库也执行。回归中的 0.0.9 是同一代码构建的测试旧版本，不能据此声称历史发行版升级兼容。
- Windows x64 安装版启动时及每 6 小时自动检查，也可从帮助菜单检查。来源固定为 `https://github.com/xhc144/caiwu-suite` 的正式稳定 Release；当前未发布本次版本。新版本须同时提供 `v<三段版本>` 标签、NSIS 和 `*-update.json`，安装包 GitHub SHA-256 必须与清单一致。下载限时、限大小、逐跳检查 HTTPS 来源；失败不复用缓存，下载后及安装前复验大小、PE 头、摘要和 Windows 内嵌版本。已验证版本高水位跨启动保留，拒绝回退；损坏记录须维护人员核实。
- 下载及安装分别确认，说明来源、版本、SHA-256 和尚无代码签名。更新使用原有 beforeunload/正常退出保护，服务或备份拒绝时不启动安装器、不清锁。正常退出后借用现有 core 独占租约，为数据目录内全部账套做 SQLite 在线备份，检查完整性/外键并保留清单；保留原文件和所有既有备份。备份失败恢复启动页，成功后运行正常交互式 NSIS，由 Windows 处理安全提示；不自动发布 Release、不自动迁移或恢复账套。

配置和日志默认在用户应用数据目录 `caiwu-desktop/`。独立测试可设置绝对路径 `CAIWU_DESKTOP_USER_DATA_DIR`，不得指向日常使用的配置目录。

Windows x64 手动打包前，在 `app/` 执行 `node apps/desktop/build/prepare-native.mjs`、`pnpm -C apps/desktop exec electron-builder install-app-deps --platform win32 --arch x64`，再 `pnpm -C apps/desktop exec electron-builder --win nsis --x64 --publish never`。SQLite 13.0.3 使用 N-API；准备脚本移除本次安装的主机 prebuild，确保入包和实际加载的是 Electron 重编译结果。

打包后执行 `node apps/desktop/build/update-manifest.mjs` 和 `pnpm exec tsx apps/desktop/qa/verify-update.ts`，生成同版本校验清单并核对真实安装包；workflow 只上传短期 Actions artifact，不发布 Release。更新备份在数据目录的 `backups/更新前-<随机编号>/`，不会纳入构建 artifact，也不自动清理。`caiwuDesktopHost.updates` 的检查/下载/安装接口仅接受主窗口、无任意 URL 或路径参数；`install()` 返回 true 仅表示已请求关闭，未保存内容或备份仍可阻断安装。

运行：在 `app/` 执行 `pnpm desktop:build`、`pnpm -C apps/desktop start`。桌面自有测试由 `pnpm exec vitest run apps/desktop` 执行。真实 Electron 回归需先运行 `pnpm exec tsx apps/desktop/qa/prepare-fixture.ts <全新绝对临时目录>`，设置 `CAIWU_DESKTOP_QA_FIXTURE` 为该目录，再运行 `pnpm exec playwright test --config apps/desktop/playwright.config.ts`；需要 Electron 本体和桌面显示。Node 夹具须在重编译 Electron ABI 之前创建。

未完成：

- 旧账套自动迁移、已发布历史安装包的升级兼容及回滚机制。
- Windows 实机原生对话框、系统打印机、中文字体/横向版面、多屏和安装界面的人工试用；脚本中的保存对话框使用测试适配器。
- 所有业务表单接入标准 `beforeunload`；本任务只提供桌面支持。
- 代码签名与证书、独立发行者签名校验；当前完整性校验依赖 GitHub HTTPS、仓库权限、GitHub 资产摘要和同渠道清单，不能替代 Authenticode。
- 本次版本的正式 Release 发布与真实跨历史版本的自动安装、安装失败恢复人工验收；没有自动发布或自动回滚账套。既有 0.1.0.4 四段版本不是本次最新版验收依据，本更新通道拒绝四段版本。
- 所有业务表单未保存状态的覆盖、Windows 实机 SmartScreen 和原生安装向导人工操作仍需根审核/人工试用；桌面机械回归的远端传输与对话框响应使用测试适配器。
