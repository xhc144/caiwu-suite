# WPF 复制窗口验证与交接

实现内容：独立可实例化的 `VoucherCopyWindow`，明确新凭证头输入、当前制单人显示、完整只读分录预览、逐字段及源行错误留窗、纠错重试、确认返回 Plan、取消返回 null。没有保存或账套读取依赖。源数据来自宿主传入的同一显示快照。

## 已实际运行

2026-10-25，Linux x64，SDK `10.0.402`：

- WPF 生产项目及 Windows 控件探针项目 Release 交叉构建，`-warnaserror`，0 警告/0 错误。
- `Logic/Caiwu.VoucherTools.Wpf.Logic.Tests.csproj`：21 项通过、0 失败、0 跳过。项目直接链接实际窗口使用的 `CopyForm.cs`，验证空字段、明确完整日期、整数边界、重号、期间、失效科目、宿主制单人、字段映射和原快照 token；没有另抄一套测试专用解析器。
- 原纯复制计划模块的 37 项合成测试已在其交付中实际通过；本次没有修改该项目。

TRX 位于被 git 忽略的 `Logic/TestResults/copy-form.trx`。各项目依赖锁文件随代码交付。

## 未实际运行：Windows WPF 控件

本容器没有 Windows/WPF 运行时。已提供并交叉编译 `Windows/Caiwu.VoucherTools.Wpf.Windows.Tests.csproj`，12 个实际窗口测试由 `Windows/run.ps1` 在 Windows 执行，当前状态为 **待运行**，不是 PASS，也不是权限拒绝。

```powershell
pwsh -File tests/Caiwu.VoucherTools.Wpf.Tests/Windows/run.ps1 -OutputDirectory C:/temp/voucher-copy-evidence
```

输出包含实际窗口 PNG、stdout/stderr 和 `wpf-results.json`。脚本核对 checkout SHA、Windows 标识、12 项状态及进程退出码；超时或缺失 JSON 会失败，不把构建成功冒充窗口通过。重复输出目录中的旧 JSON 会被拒绝，避免误读旧证据。

探针检查初始空字段与完整行预览、无资源时 Fluent fallback、每个字段错误保留输入、重号、已结账日期、停用科目行反馈、有效确认后由宿主单独保存、取消按钮、Esc 路由、关闭窗口、过期 token 原样保留、宿主全局样式优先、修正后单次确认。实际 WPF 路由事件覆盖控件处理逻辑；原生鼠标输入、IME、物理 Ctrl+Enter 及人工视觉审查仍需 Acceptance 验证。

## 最小集成

先集成 Contracts/Core v1.2 和纯复制计划提交 `dab8681937b55324584f89146ae048ca248341a4`，再接本次 WPF 提交。由 Desktop owner 添加 ProjectReference/solution/CI、菜单命令及未保存草稿工作区。窗口调用与宿主保存示例见 [WPF README](../../src/Caiwu.VoucherTools.Wpf/README.md)。没有修改 MainWindow、Contracts、Core、SQLite、全局主题或安装/更新保护。
