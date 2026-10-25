# BookTools 交接

2026-10-25 UTC，`codex/book-copy-tools`；基于 `a49d426d8513600dec0f624f56a35c9ad66e71d4`。所有新增内容仅在分配的两个目录。没有改书库、Desktop、Contracts、Core、SQLite、根 solution、安装更新保护或仓库权限。

## 可集成结果

- **success：结构化复制闭环。** 两种范围均以新 BookId/名称创建；使用现有 Storage 一致性快照和备份 API，规范新 schema 保存、完整字段回读及重新打开比较、无覆盖发布。失败/取消不留目标半成品。恢复副本仍由原 API 保留原身份及版本。
- **success：合成 SQLite 行为验证。** 40 项测试实际通过（Release，0 失败/跳过），包括实际 SQL、Core 余额/新凭证闭环、源/只读备份 hash 不变、审计历史、嵌套快照冻结、相同 BookId 恢复与新身份拒写区别、无 revision 增量的数据变化、取消、并发目标/日志抢占、回读不一致、WAL 提交隔离与捕获后新写入。完整命令和范围在 `tests/Caiwu.BookTools.Tests/validation.json`。
- **success：WPF 项目交叉编译。** 独立确认窗口、工作流和全部依赖使用 .NET 10.0.402 / runtime 10.0.13、SQLite 包 10.0.13；Release build 0 warning / 0 error。锁定依赖 restore 通过，没有新增运行时包。
- **unverified：真实 Windows 操作与宿主入口。** 未在 Windows 打开此窗口；未宣称键盘、DPI、屏幕阅读器或 Desktop 菜单已验收。主集成需按 `README.md` 添加项目引用/solution/菜单，并沿用未保存编辑检查、受管数据根策略、Delivery 文件策略、租约和新账套登记。默认保持当前源会话；没有自动执行真实账套。

## 关键文件

| 文件 | 作用及依据 | 置信度 |
| --- | --- | --- |
| `BookCopyService.cs` | 纯预览与显式执行、字段保留、公共 Storage 调用、发布屏障；真实 SQLite 测试支持 | high |
| `BookCopyPlan.cs` | 不可变计划、范围、数量、字段规则和限制；身份/范围测试支持 | high |
| `SnapshotData.cs` | 深冻结及保序的全契约指纹；同版本数据变化/嵌套列表/回读反例支持 | high |
| `CopyPaths.cs` / `CopyWorkspace.cs` | 路径/日志不覆盖、仅本次预留临时文件清理；抢占、symlink、取消及未知文件保留测试支持（symlink 仅 Linux） | high |
| `BookCopyWorkflow.cs` | 明确确认、输入撤销计划、单次执行、忙态、失败重新确认和源刷新；工作流测试支持 | high |
| `Wpf/BookCopyWindow.xaml` / `.xaml.cs` | 独立 modal 确认窗口；已编译，真实窗口操作未运行 | medium |
| `README.md` | 字段语义、API、LedgerSession 最小接法与未完成边界 | high |

## 有复用价值的失败/修正

首轮扩展边界测试有 1 项断言失败：直接在 JSON 文本中寻找中文来源名称，而标准 JsonSerializer 会转义非 ASCII。改为解析 JSON 的 `SourceName` 再比较；复制结果本身的字段未因此改变。修正后全量行为测试通过。

检查发布路径时发现最后一次规范化结果应与确认路径再次比较，已补充比较及宿主目标策略复验。临时文件所有权在分配时预留，避免 Storage.Create 发布临时候选后重新打开失败时遗漏清理。没有掩盖测试失败或以测试数量代替功能完成。

## 未完与限制

1. 主集成添加菜单/项目引用以及 Windows 真实窗口验证，分发暂停门槛保持原样。这是未执行的集成工作，没有权限拒绝或未知推送结果。
2. “全量”仅当前 DTO 字段；实际附件文件、外部报表、权限、成本数据、原账套导入、制度迁移、滚年及全局跨账套 ID 重映射不在本模块范围。
3. 复制只绑定捕获时与预览一致的快照；不锁住后续所有源写入。没有跨库原子事务/断电恢复认证。当前用户权限下恶意目录替换、Windows junction/ACL/8.3 别名没有实机验证。
4. 宿主集成 Delivery 时，传入现有 `LedgerFilePolicy.Validate` 和受管目标路径验证，不另造备份/恢复或更改 Core 生产约束。未传策略时只具备本模块和 Storage 的已说明门槛。

成果提交/推送/草稿 PR 由本轮最后步骤完成；最终远端 SHA 和 PR 链接以交付回复为准。没有公开、合 main 或发布安装包的步骤。
