# BookTools 小屏幕工作区修复

2026-10-25 UTC，root 在收到第一阶段 PR29 后明确要求只关闭这个已知 UI 问题。**success：1024×768 和 1920×1080 两种实际 Windows 显示模式下，输入/预览可滚动，底部确认/取消始终在工作区内，并已通过原生鼠标实际操作。**

- 最小生产修复 SHA：`49b194ee3fe86a514aade8c6808f160d219f9d8c`，仅 `src/Caiwu.BookTools/Wpf/BookCopyWindow.xaml` 和 `.xaml.cs` 两个文件。
- 真实 Windows 验收 SHA：`083727a0697182cd0831040f6298e42d92761089`，增加本组回归和现有聚焦 workflow 的 WPF 路径触发。
- [最终 CI 40189370810](https://github.com/xhc144/caiwu-suite/actions/runs/40189370810)：BookTools、Voucher、Summary 三个 job 均 success。[BookTools 原始 artifact 12597253973](https://github.com/xhc144/caiwu-suite/actions/runs/40189370810/artifacts/12597253973)。
- BookTools 原始 ZIP SHA256：`d21d0d7bdba5f1c9caa7d85e1498d5f664c7a155b6cc6f741e2f18f972b4e05a`。原始 PNG/JSON/日志、工作流结果和 archive 元数据保存在 `evidence/workarea-083727a/`；所有文件和逐图片收据已本机重算匹配，字节未改。

## 修复内容

窗口读取当前 HWND 所在显示器的原生 MONITORINFO 工作区，用当前 WPF CompositionTarget 的 TransformFromDevice 转成 DIP，再约束 MaxWidth/MaxHeight、实际尺寸和位置。初始化与 CenterOwner 定位后均检查；完成跨屏拖动、显示模式或 DPI 消息后重新排队约束。此消息处理实现不等于已完成多 DPI 验收。

输入和完整复制计划共用一个有明确视口的纵向滚动区；生成预览后滚到预览开始。确认、状态和执行/取消按钮留在独立固定底部。确认文字可以换行，超长状态有自己的限高滚动区，避免长错误把按钮挤出。保留原控件名称、绑定、点击 handler 和公开入口。

没有变更复制计划、执行工作流、发布、临时文件、Core、SQLite、Contracts、Desktop 入口或全局主题。与 `0650a7f` 逐文件 diff 已确认这些生产部分没有变化。不是仅裁短窗口隐藏内容。

## 实际运行的验证

两种分辨率均通过 Win32 ChangeDisplaySettings 设置并由 GetSystemMetrics 确认，退出后恢复原显示模式；没有对图片缩放模拟分辨率。每种模式各运行取消和确认两个真实模态窗口：

1. 用独立 Win32 GetMonitorInfo/GetWindowRect 检查整个 HWND 在实际工作区内，确认复选框、执行和取消控件的屏幕矩形也完整在工作区内。
2. 实际输入框可滚入视口并获得 IsKeyboardFocused；非法输入下通过原生鼠标点击预览，窗口留开并显示错误。随后输入有效合成目标并实际点击生成计划。
3. 分别滚到内容顶部、底部再次检查固定底部控件矩形。鼠标目标先做 WPF InputHitTest 排除遮挡，再以真实 SetCursorPos + SendInput down/up 点击预览、确认复选框及最终按钮，没有直接 RaiseEvent 代替这些新用例的点击。
4. 原生鼠标取消后没有目标文件、Result 为空、源哈希不变；原生鼠标确认后结果真实落盘，以新身份重开并检查内容与源哈希。

| 实际显示 | 实际工作区 | 示例完整 HWND（像素） | 实测 DPI |
| --- | --- | --- | --- |
| 1024×768 | (0,0)–(1024,720) | (156,0)–(946,720) | 96×96 |
| 1920×1080 | (0,0)–(1920,1032) | (78,78)–(868,818) | 96×96 |

原图可直接比较：

- `BookTools/book-workarea-1024-confirm-desktop.png` / `book-workarea-1024-cancel-desktop.png`：1024×768 全桌面原图，底部按钮在任务栏上方。
- `BookTools/book-workarea-1920-confirm-desktop.png` / `book-workarea-1920-cancel-desktop.png`：1920×1080 全桌面原图。
- 同名去掉 `-desktop` 为完整 HWND PrintWindow 原图；JSON 记录 DPI、原生尺寸、工作区、窗口边界和 SHA256。

既有 BookTools 关键回归仍全部运行：预览不写、改输入撤销确认、两种复制范围/重开余额、陈旧源拒绝并留窗、执行中安全取消，以及 30 轮同步同目标发布。每轮均只有一方成功，失败方 IOException、两源及成功者哈希不变、临时目录清理。没有运行全局 Core/Storage 或安装套件。

## 集成与未验范围

root 若只取生产修复，拣选 `49b194ee3fe86a514aade8c6808f160d219f9d8c` 即可；连同 QA 则再取 `083727a0697182cd0831040f6298e42d92761089`，以及随后只保存证据/交接的提交。PR29 持续为 draft，不合 main。

原有运行命令不变：`./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module BookTools`。新两个 case 会实际设置 1024×768、1920×1080，若不支持则失败，不缩放、不 skip。全部模态和进程超时仍计失败。

本次只关闭这两个实际分辨率、96 DPI 下的工作区/原生鼠标命中问题。字段内容通过 WPF 属性设置，没有宣称物理键盘、IME、多 DPI、混合 DPI、多显示器移动实测、屏幕阅读器或安装/宿主整体组合验收。当前没有权限拒绝、未知执行结果或此小修的剩余 blocker。
