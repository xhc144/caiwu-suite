# 第二阶段主集成与 Windows 验证

更新时间：2026-10-25 09:49 UTC。私库分支 `codex/sprint-integration-2`，基线 `codex/windows-revalidation`，草稿 [PR16](https://github.com/xhc144/caiwu-suite/pull/16)。当前代码提交 `5e21ac321f119efd30a4a11780b27ee651f58221`；本阶段最迟 11:00 UTC 结束。**交付仍暂停，没有新 ZIP/安装器或 main 合并。**

## 已接入的代码

| 来源 | 本分支接入 | 实际范围 |
| --- | --- | --- |
| 旧阶段 `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5` | 实际克隆的目标基线 | 包含 `fa463b7`，v1.2 UI 原快照/会话代次、App 文件门槛、导航保留和既有回归入口 |
| Contracts `bb76658`、Core `6662120`、Storage `ecc5225`、Delivery `ef17e64`、Controls `633cfb9+bf75d56` | 基线已包含，逐生产目录/关键 blob 比较一致后未重复拣选 | 独审 `49de1be` 与导航 `0f8fb850` 的探针也已纳入基线；合成夹具已适配 v1.2 |
| 视觉 `79f7665 → 87b7773 → 9b544ed → 33985eb` | `08f93a3`、`9d29b8a`、`5907596`、`22c9069` | 作者 XAML/资源原样拣选，未抢改其视觉文件；期初金额 PropertyChanged 绑定和 BackButton/Back_Click 保留 |
| Delivery `d6f92dcd9361260eb5a6eced7fc4909fa914311e` | `059cae6` | 已关闭一致快照取 hash；同一快照绑定备份报告与副本；不放宽生产 payload 的严格共享 hash |
| Storage `4e8664d5db711b6fe8543a1bf3c689f3f39c2a30` / PR23 | `3f844de` | 作者窄发布修复：Unix 原子 link 拒绝覆盖，Windows 保留不覆盖 Move；失败只清本次暂存。未删除事务深读回、revision CAS、账套保护 |
| 本阶段测试/调度 | `1ee0360`、`e9c4368`、`7faf419`、`4cfeb11`、`5e21ac3` | 导航文字兼容、两项原生键盘焦点、六项旧窗口隔离和消息循环修正、Windows 发布竞争复验、实际桌面尺寸准备 |

Delivery 的 `BookInspection.FileSha256Basis` 现在区分 `sqlite-consistent-copy`（输入检视）和 `database-file`（新输出文件）。调用者不能把前者当成活跃主文件原字节的 hash。Core/Contracts 没有本阶段自行改动，SQLite/Delivery 生产变更均来自对应 owner 提交。

没有接入下一阶段成本、Summary 管理、Voucher 复制、BookTools 等 UI/业务模块，也不把它们写成当前用户可用功能。BookTools 旧发布逻辑仍禁止接入。书库、原安装器、真实原窗口/SQL/对象目录和新派生 catalog 未修改或上传。

## 本阶段实际验证

Linux：Debian 13，官方 SDK 10.0.402 / .NET 10.0.13，SDK SHA512 与仓库元数据相符。Windows：实际 GitHub windows-latest 桌面、Windows 10.0.26100。所有账套均为合成数据；表内不同口径不能相加作功能完成数。

| 检查 | 本轮实际结果 | 精确证据与限制 |
| --- | --- | --- |
| Release solution、WPF/NativeFocus/MutationWindows/VisualReview/高清/导航/双进程交叉编译 | 0 警告/0 错误 | 交叉编译不算 Windows 运行 |
| 独立 v1.2、链接真实 Session/Preview 和 SQLite | 22 通过 | `08f93a3` 和发布修复后 `5e21ac3` 都实际运行；快照/输入/audit/revision 比较保留 |
| Core 单测 | 149 通过 | `08f93a3`；Core 生产代码随后未变 |
| Desktop 逻辑及真实 SQLite/Core/session | 28 与 12 断言通过 | 实际 exe；发布修复后真实集成再跑 12 通过。银行 108800、本期借贷各 31200、期末借贷各 120000 |
| SQLite 发布修复前 | 全量 108 通过 / 1 失败；原竞争入口 12 轮中 10 失败 / 2 通过 | 原始 TRX 保留；两个同目标创建均成功，不能被偶尔绿灯覆盖 |
| SQLite 发布修复后 | 全量 116 通过；原竞争入口 12/12 通过 | 本线程组合下独立运行；作者另有 tmpfs/overlayfs、64 对线程和 64 对进程证据，不冒充本线程实跑 |
| Delivery Linux 修复后 | 144 通过 / 0 失败 / 3 跳过 | 3 项要求原生 Windows 共享语义，不记为通过 |
| Delivery Windows 修复后 | **143 通过 / 0 失败 / 4 跳过** | `d6f92dc` run40181053280 和组合 `f68f863` run40181306433；六项新增共享/WAL/失败保留均通过，旧共享 P1 已有定点实证关闭 |
| 实际 WPF 输入/错误/忙锁/重复保存/只读 | 8 项通过 | `f68f863`；包括旧草稿再次提交仍拒绝并保留原 token/输入 |
| 实际新建保存位置取消、报表联查/返回 | 2 项通过 | `e9c4368`、`33985eb`、`f68f863`；日期/科目/业务行/双向滚动保持，合成账套/audit/revision 不变 |
| 原生 F4 键盘焦点 | 2 项通过 | `e9c4368` 和 `f68f863`；取消回原摘要格、保留输入；选择后借方编辑框原生键入 42.75。96 DPI；不是物理键盘/IME 认证 |
| App Open/Restore gate 与两个真实进程 | 3 项通过 | `f68f863`；同账套旧编辑器拒绝、异账套不串账，App 文件门槛先于 Storage |
| 实际旧科目表单、同身份/同版本恢复旧编辑器 | 2 项通过 | `f68f863` 的六项隔离探针中的 ACCOUNT、SAME-IDENTITY-RESTORE |
| 实际旧期初/删除/审核/记账 | **4 项 BLOCKED** | `f68f863`；确认和冲突原生提示均出现，探针在 UI 线程同步等待原生驱动回收而卡住。`5e21ac3` 已修消息循环，待新 Windows 实跑；不记为生产功能通过 |
| 可选六窗口资源/PrintWindow 检查 | **失败，0 张** | `f68f863` 的窗口尺寸被原桌面限制；`5e21ac3` 增加真实桌面模式准备与恢复，保留 1920×1080 门槛，待 Windows 复跑 |
| Windows SQLite 全量 | **64 通过 / 45 失败** | `d6f92dc`/`f68f863`，45 个都在 ReadbackTests 的活跃连接原字节读取被 File.ReadAllBytes 的共享规则拒绝，尚未到回滚断言；需 Storage owner 修合成夹具，不删深读回/回滚断言、不放宽生产保护 |

## 可交给根的实际高清图

主四页入口采用原生桌面 BitBlt，已逐 hash 核对并亲看：主界面、可编辑凭证、银行明细、基础报表全部为 **1920×1080、96 DPI、未拉伸**。这是实际自研窗口和合成账套，不是设计稿。

- 最新字体/边框源码 **33985eb75574b008df8dce320db2ddb3e4f3121b**，run **40180961028**，artifact **12593554752**，ZIP SHA256 `76ba335cf13d37b9a1f89aca900d51f611f7959db5a1501e67081619c1aea900`。
- 原生焦点/导航修复源码 **e9c436803d287937d5314e6bd3f7360e71b219ff**，run **40180883501**，artifact **12594388585**，ZIP SHA256 `bfbf64122795178720b9fcf789ef9f060423ef92324803715688b8512936a3b7`。这些步骤完成后整轮被后续调度取消，不称全 run 通过。
- 现代视觉 + Delivery 组合 **f68f86361f76dda786559623b1a76458a2fbd596**，run **40181306433**，artifact **12593918462**，ZIP SHA256 `677788b67e86e454db193962913c9eb4b5db947b5c99fecb52147280d88ed33f`。
- 第一版 artifact12594028382 只对应 `79f7665`；不能当作新版 `33985eb` 图。所有逐图 hash、原始结果和 artifact 版本范围见 [证据索引](evidence-sprint-integration-2/windows-artifacts-index.json)。

## 当前运行和剩余交接

当前 [Windows run40182073681](https://github.com/xhc144/caiwu-suite/actions/runs/40182073681) 精确 checkout **5e21ac321f119efd30a4a11780b27ee651f58221**，含 Storage 发布修复、原生消息循环和可选截图尺寸修正。未完成前不推定通过；没有重复触发相同组合。

1. 等 Storage owner 的 Windows ReadbackTests 合成夹具补丁，保留上述 45 失败原始 TRX；随后按提交拣选并在 Windows 全量复验。当前未自行改该 owner 的测试/生产实现。
2. 读当前 run 的四项原生确认、可选资源检查和 Windows 发布竞争（116 项 + 原入口 12 次）结果，具体诊断失败；不以 console 22 或编译代替真实窗口。
3. 实际完整 Desktop 安装器/升级尚未执行：现有 Desktop `managedDataContract=false`，且暂停门槛禁止生成新分发包。已跑合成受管 CLI/文件保留和共享保护，不声称完成实际安装器闭环。保留暂停标记、更新禁用和账套保护。
4. 物理键盘/中文 IME、多 DPI/多显示器焦点、NTFS 断电/恢复尚未运行。没有权限审批待办；上述是技术验证与已限定阶段范围，未采用绕过路径。

整体通过 PR16 审阅接到目标开发分支，先核远端最新头；不要覆盖他人分支或重复拣选基线已有 Core/Contracts/Controls/独审修复。不合 main、不改权限、不公开、不发布安装器。文档/原始证据后续保存提交不改变代码；交接时同时给代码 SHA 和最终文档 SHA，并以树比较说明关系。
