# 桌面新功能接入：实际验证与交接

代码提交 `11924347082b72c4ee6cdcfd9ea106c2e33934da`，私有分支 `codex/desktop-feature-wiring`，草稿 [PR25](https://github.com/xhc144/caiwu-suite/pull/25)。实际入口、四个作者 SHA、项目引用和一处初始化 hook 均在 [HOST_INTEGRATION.md](../../src/Caiwu.Desktop/Features/HOST_INTEGRATION.md)。只新增分配目录及新 partial。

## 可直接集成的结果

- 复制凭证：真实作者选择窗口 → 宿主未保存 Draft 工作区 → 显式保存。新身份/制单人、原快照 token、会话 generation 都保留；冲突和输入错误留窗，保存成功只消费一次。没有自动审核或记账。
- 摘要：真实作者管理状态机的 async 窗口适配。只有 catalog I/O 进后台，状态通知留在 UI context；分类/条目的原 ID 和编辑版本不随搜索或保存时重读替换。使用宿主已有数据位置与独立附件登记，缺配置时禁用。
- 账套复制：真实 `8bbf842` BookTools 窗口与 Delivery 源验证；宿主真实租约、受管新目标和新账套登记必须一起提供。操作人由宿主固定，结果默认仍保留源账套；登记失败明确区分“文件已创建”。缺配置时禁用。
- 成本：承载真实 `CostWorksheetPage`，输入来自当前显示账套与期间，仅人工审核建议。没有账务写入回调。

## 本轮 Linux 执行

`validate-combination.sh` 从上述代码提交及固定作者提交创建独立临时 checkout，只在那里应用四个必要项目引用。实际结果：

| 行为/检查 | 结果 | 证据 |
| --- | --- | --- |
| Desktop 完整组合 Release 编译，warnings as errors | 通过，0 警告/0 错误 | `evidence/desktop-build-1192434.log` |
| 真实 SQLite、摘要文件及实际 FeatureSessionBinding/PendingVoucherCopy/AsyncSummaryStateAdapter | 13 场景通过 | `evidence/logic-1192434.json` |
| Windows/WPF 窗口探针交叉编译 | 通过，0 警告/0 错误 | `evidence/windows-cross-build-1192434.log` |
| Windows 实际窗口执行 | **未运行** | 当前是 Linux；不是通过或跳过后计作通过 |

服务场景验证取消不写入、显式单次保存、验证失败更正后重试、新 Draft 身份/状态、外来 token 拒绝、同 BookId 恢复/重新打开旧窗口失效、外部 SQLite 写入冲突且不刷新 token、摘要精确备份收据、摘要并发编辑保留 ID/版本/输入、搜索清除当前选择后仍保存原编辑 ID、取消摘要编辑无写入。断言比较真实持久化数据，不以测试数量代替窗口功能完成。

详细 source/probe SHA256、固定依赖 SHA 与验证状态在 `evidence/validation-1192434.json`。源码提交之后只补证据/说明，生产代码及探针哈希可复核。

## Windows 接手命令

```powershell
pwsh -File tests/Caiwu.Desktop.FeatureTests/Windows/run.ps1
```

实际模态窗口脚本有 90 秒进程 watchdog，10 个合成场景，输出 checkout SHA、JSON 和 WPF 渲染 PNG：菜单/禁用原因、复制取消/错误留窗/更正保存、同身份旧窗口、摘要后台 I/O 与 UI context 通知、摘要持久化/冲突/无效 query、恢复后摘要窗失效、成本建议不记账、BookTools 取消/确认成功且保持源会话。它使用真实 Routed Button.Click，不能替代物理键盘/IME、多 DPI 或 Windows 并发发布压力验收。

## 必须继续保持的门槛

1. **pending owner**：Desktop owner 按文档加四个项目引用和一处初始化 hook。分支自身没有越权补其他 owner 的模块或 csproj；组合编译通过不能表述为该单分支已独立装配完毕。
2. **pending owner**：摘要实际附件清单、整体备份/恢复和新路径映射；BookTools 真实 Delivery 数据租约、受管目标及新账套登记。默认禁用是有原因的门控，不能用空委托开启。
3. **not run**：Windows 真实窗口、BookTools Windows 并发发布、真实租约与安装升级。安装/升级/交付暂停保护原样保留，没有生成或发布安装包。
4. **pending author/root**：Operators 集中授权 ledger adapter 与组合根。已读 `7a1e673` 并写清首次设置后显式登录、可信 ActorKey、注销/换人关闭旧 LedgerSession 再重开、旧姓名不猜映射。未声称旧自由姓名输入已成为认证。
5. 成本作者页面的大工作表计算/导入导出延迟尚未量测；本轮没有改其实现，也不承诺任意规模都无 UI 延迟。

没有当前权限拒绝或不确定的推送结果。早期两个共享输出目录的编译并发造成一次 GenerateDepsFile 占用失败，后续顺序执行均通过；保留此说明避免重复同一验证调度错误。未读取/上传参考安装包字节或派生 catalog，仅合成账套参与验证。
