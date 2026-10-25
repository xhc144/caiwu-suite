# 隔离 Windows 复验组合

仅开发分支 `codex/windows-revalidation`，不改/强推 `codex/windows-mvp`，不合 main、不新建凭据、不发布包/Release。交付暂停标记保持。

基线：`cf334c93aca6c33f48411ceea77d7044c1bf161f`，protected main 只读检查为 `e240621e31a0071c61153818ef50a21b3c01faf8`。指定的四个提交均未在这两个 ref 的祖先链中。

| 来源提交 | 组合提交 | 内容 |
|---|---|---|
| `53fe0f2d2744e557dab98bf2652ffa5fce644c25` | `603436f` | Core v1.1 草稿 token 强制校验及回归 |
| `49de1be88c69138e2ab49d922f92ec9c1f51b0c1` | `ac7de4a` | 独立 23 项后端复验与 8 项 WPF 探针 |
| `633cfb9622c7c14ad43824de3cbc20cd44b1be45` | `b69143a` | 自研 Controls/选择对话框及 Windows smoke |
| `bf75d563a325fa257c9097740dbcd0caa2e0b000` | `5114c2d` | Controls 边界、重复完成与焦点恢复 |
| `983e2e3`、`87b3fbf` | `48bd05f`、`f587d45` | Delivery 代码与必要测试依赖；未拣选仅含旧发布证据的 7e1074f |
| `8e989034eb984910a39d01f28a8f64c0aeeba486` | `5a276a5` | Delivery 边界修复；作者结果仅作为输入，待本分支实际复验 |

冲突只涉及 Core 历史 token 提案/已删除的旧探针 README，以及 Delivery 交接 Markdown。生产代码没有用“保留一侧”掩盖冲突。保留基线对旧 README 的删除，更新提案状态为已合 v1.1、仍待其他修复。

## 最小接线

`App.CreateBackend` 集中供生产启动与验收使用。Open 和 Restore 委托在调用直接 Storage 前执行公共 `LedgerFilePolicy.Validate`；Create 保持新文件创建路径。Desktop 只增加对已有 Delivery 项目的引用，不重写存储或契约。

现有 8 项 WPF 探针改用这个实际 App backend，避免测试里自行构造未接安全门的替代后端。

## Windows 场景与证据边界

复用 `windows-build.yml` 的 pinned actions 和 SDK10.0.402，增加本分支 push 触发、Controls/Delivery 独立项目预构建与明确的 Windows 复验步骤。原核心检查和 8 项 WPF 不减；额外运行 Controls `Run-WindowsSmoke`、独立 SQLite 23 项及 `DualWindows`。暂停标记缺失、出现 ZIP/installer 均失败；只上传 JSON、日志、TRX、PNG，不上传运行时程序、账套或分发包。

`DualWindows` 真正启动两个独立 .NET/WPF 进程，每个都加载实际 MainWindow 与 VoucherEditorWindow，并使用真实 App 后端/SQLite。它通过已有 verification hook 打开合成账套，程序填充实际行模型并触发实际 Save routed event：

- 同一账套 A/B 均先打开 10，B 填 30，A 保存 20；B 两次保存都必须留窗、保留摘要/金额及原 token，落盘完整快照保持 A 的新值。
- 不同合成账套 A/B 分别保存 20/30，独立核对 BookId 和金额不串。
- 实际 App 的 Open/Restore 均拒绝合成带触发器的账套，并核对源字节不变和恢复目标未发布。

记录每个进程的 opening BookId/revision、实际发送 token、输入、错误、落盘摘要/金额/版本和 PNG。它不是物理键盘/IME/原生文件对话框操作；Controls 的 TextComposition 事件模拟也不是实际安装输入法验收。Controls 当前以独立组件/宿主 smoke 验证，不据此声称产品 F4 已改为这些新对话框。

## 已知阻断保持

根提供 `71f815af513402d5105196e45b79d6bdd3561848` 的独立 Core 风险：旧期初覆盖、旧科目重新启用、旧选择删除新草稿、审核未见新金额、确认 10 实际记账 20。这些由 Core owner 定义 v1.2 来源快照契约并实现；本分支不自行改 Contracts/Core 或刷新 token 掩盖风险。即使当前验证工作流绿灯，这五项仍阻断交付。

Delivery 的 schema 约束/`UNIQUE(summary) ON CONFLICT REPLACE` 候选风险仍待根和作者的实际反例与修复。原“accounts 调换列序导致先读对后写错”例子已撤回，不作为缺陷或修复理由。当前 policy 接线不等于备份安全验收通过。原生安装/NTFS、真实断电、正向可信签名及完整受管数据升级仍未验证，且此次不生成安装器以绕过暂停门槛。

本文件为执行计划与组合说明；实际 CI URL、不可变组合 SHA 和通过/失败由后续运行报告记录，不能以本文件或 Linux 交叉编译冒充 Windows 已运行。未拣选或上传原安装包、原资源本体或本任务暂停共享的新模板派生表。
