# 独立验收：首批阻断发现

目标：`xhc144/caiwu-suite`，`codex/windows-mvp`，不可变提交 `037a07585078d4dfcd443a2cc4a237c88aed07a0`。2026-10-25。

## P1 / ACC-001：主窗口账表不能完整辨认（已看 CI 原图）

来源：[Windows CI 40172477245](https://github.com/xhc144/caiwu-suite/actions/runs/40172477245)，job `121106056815`，artifact `12591076154`。下载外层 ZIP 的 SHA256：`0d37cdbd08fe368e14d516b0836a9c11a352c70da1380036d0424262ad21c560`，与 API 和 job 日志一致。

定点观察 `voucher-list.png`、`trial-balance.png`、`opening-balances.png`：表格占满窗口，但列全部收缩在左侧；日期、名称、金额仅显示少数字符，表头也不能辨认。例如余额表银行存款的 108800 不能从对应行完整读出。列表无法可靠辨认待审核/记账的凭证，期初余额无法正常核对输入位置。这阻断“快速真实可用”的基本要求。

复现来源是该提交自身 CI 的真实 WPF RenderTargetBitmap 输出，本验收未在 Windows 人工操作。`posted-voucher.png` 内凭证编辑器列宽正常，但边缘有裁切/透明区域；该截图不能证明键盘、焦点和实际桌面背景呈现。

源码定位线索：`src/Caiwu.Desktop/MainWindow.xaml:3` 的窗口级隐式 `DataGrid` Style 未声明 `BasedOn`；编辑器没有这个窗口级样式。列在 XAML 中本有明确宽度。主题样式覆盖是待实现线程定点验证的原因假设，不能只改样式后靠构建宣称已修复。

修复验收要求：重跑 Windows 窗口渲染，看原始新 PNG，检查表头、完整日期、至少六位数金额、横向滚动和期初可编辑单元格；再完成人工/自动输入验收。

## CI 成功的边界

现有流水线：Core 53、SQLite 63、界面纯逻辑 13、集成 9 全部通过。`UiVerification.Run` 先用 `SampleLedger` 直接调用服务生成三张已记账凭证，然后程序切页并截图；`manualInteractionTested=false`。没有通过按钮/键盘实际执行新建账套、保存草稿、审核、记账、备份恢复或锁期。截图元数据 `success=true` 只表示截图代码没有抛异常，不包含布局可读性断言。

## 尚未判定

Linux 环境不能运行 WPF；后续实际回归和问题状态见 [完整验收报告](037a075-independent-acceptance.md)。会话日期顺序的初步怀疑未获得实际事件绑定支持，已撤去；其余结论分层记录。未运行原商业 EXE，未下载原安装包。该提交没有 `docs/reference-ui` 入口；未见共享子页不作为证据。
