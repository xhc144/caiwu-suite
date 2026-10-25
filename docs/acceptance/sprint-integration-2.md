# 第二阶段主集成与 Windows 验证

更新时间：2026-10-25 10:06 UTC。私库分支 `codex/sprint-integration-2`，基线 `codex/windows-revalidation`，草稿 [PR16](https://github.com/xhc144/caiwu-suite/pull/16)。当前已实跑代码提交 `b3b85eb3ab7fa859a3c44cca5bb6d25d48d7b434`；后续仅保存文档/建议补丁。本阶段最迟 11:00 UTC 结束。**交付仍暂停，没有新 ZIP/安装器或 main 合并。**

## 已接入的代码

| 来源 | 本分支接入 | 实际范围 |
| --- | --- | --- |
| 旧阶段 `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5` | 实际克隆的目标基线 | 包含 `fa463b7`，v1.2 UI 原快照/会话代次、App 文件门槛、导航保留和既有回归入口 |
| Contracts `bb76658`、Core `6662120`、Storage `ecc5225`、Delivery `ef17e64`、Controls `633cfb9+bf75d56` | 基线已包含，逐生产目录/关键 blob 比较一致后未重复拣选 | 独审 `49de1be` 与导航 `0f8fb850` 的探针也已纳入基线；合成夹具已适配 v1.2 |
| 视觉 `79f7665 → 87b7773 → 9b544ed → 33985eb` | `08f93a3`、`9d29b8a`、`5907596`、`22c9069` | 作者 XAML/资源原样拣选，未抢改其视觉文件；期初金额 PropertyChanged 绑定和 BackButton/Back_Click 保留 |
| 视觉正式交付 `7a845d4`，后续诊断 `88325ed + de804ac` | `7c7cd1b` 按作者最终 blob 导入；`bedabdc` 拣选诊断 | 完整 Fluent Light、命名原生模板、字体/报表对齐、作者已实测的桌面模式准备与恢复。不是重新拣选旧范围；当前视觉文件与作者该版本一致。后续表格字重/报表格式修正尚待作者交付 |
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
| 实际旧期初/科目/删除/审核/记账、同身份恢复旧编辑器 | **6 项全部通过** | `b3b85eb` run40182949333；原财务断言全部保留。此前四项 timeout 的直接原因已实证为原生唯一 OK 按钮 ID 是 2，探针错误固定查 ID1。消息循环修正单独不足以关闭；现在定位本进程目标框内唯一可见/启用 OK 实控件，记录真实 ID 并点击，未改生产代码 |
| 可选六窗口资源/PrintWindow 检查 | **9 项通过，6 张原生 1920×1080 图** | `b3b85eb`；源码字体/模板属于已交 `7a845d4` 范围，含原生模板身份、日历、菜单、可编辑金额、已记账只读、Controls 和金额对齐。没有拉伸；不称已获用户最终视觉认可 |
| Windows 发布竞争专项 | **7 项通过，原入口 12/12 通过** | `5e21ac3` run40182073681，实际 Windows 线程/双进程 Create、Backup、Restore、晚到目标和失败清理；完整 SQLite 套件仍被下述夹具阻断 |
| Windows SQLite 全量 | **71 通过 / 45 失败（116 项）** | `5e21ac3`。45 个都在 ReadbackTests 的活跃连接原字节读取被 File.ReadAllBytes 的共享规则拒绝，尚未到回滚断言；需 Storage owner 修合成夹具，不删深读回/回滚断言、不放宽生产保护。早期 d6/f68 是 64/45（109 项） |

## 可交给根的实际高清图

主四页入口采用原生桌面 BitBlt，已逐 hash 核对并亲看：主界面、可编辑凭证、银行明细、基础报表全部为 **1920×1080、96 DPI、未拉伸**。这是实际自研窗口和合成账套，不是设计稿。

- Fluent Light/原生日期与下拉源码 **7a845d4e637326c28774740580b675fcc5d240c4**，成功 run **40181737928**，主四图 artifact **12594895184**，ZIP SHA256 `0297cd7df1de77722684210d8827ee583f8ea28a155e2906b407730a2cfd382a`；九项检查、六张窗口图及 WPF/导航证据为 artifact **12594223314**。
- 核心旧窗口 + 原生焦点 + 资源组合 **b3b85eb3ab7fa859a3c44cca5bb6d25d48d7b434**，成功 run **40182949333**，artifact **12594657891**，ZIP SHA256 `3ed06cb8ed30e091db2dab09c39dccf39c607f95dc7cba45d395eaa5fd17ba6b`。
- 较早字体/边框源码 **33985eb75574b008df8dce320db2ddb3e4f3121b**，run **40180961028**，artifact **12593554752**，ZIP SHA256 `76ba335cf13d37b9a1f89aca900d51f611f7959db5a1501e67081619c1aea900`，保留为旧版本证据。
- 原生焦点/导航修复源码 **e9c436803d287937d5314e6bd3f7360e71b219ff**，run **40180883501**，artifact **12594388585**，ZIP SHA256 `bfbf64122795178720b9fcf789ef9f060423ef92324803715688b8512936a3b7`。这些步骤完成后整轮被后续调度取消，不称全 run 通过。
- 现代视觉 + Delivery 组合 **f68f86361f76dda786559623b1a76458a2fbd596**，run **40181306433**，artifact **12593918462**，ZIP SHA256 `677788b67e86e454db193962913c9eb4b5db947b5c99fecb52147280d88ed33f`。
- 第一版 artifact12594028382 只对应 `79f7665`；不能当作新版 `33985eb` 图。所有逐图 hash、原始结果和 artifact 版本范围见 [证据索引](evidence-sprint-integration-2/windows-artifacts-index.json)。

## 当前运行和剩余交接

当前 [独立交互 run40182949333](https://github.com/xhc144/caiwu-suite/actions/runs/40182949333) 在 **b3b85eb3ab7fa859a3c44cca5bb6d25d48d7b434** 已整体 success。前一个完整 run40182073681（5e21ac3）仍为 failure，不能用独立交互绿灯覆盖其 45 个夹具失败。没有重复触发相同组合。

1. 等 Storage owner 的 Windows ReadbackTests 合成夹具补丁，保留上述 45 失败原始 TRX；随后按提交拣选并在 Windows 全量复验。当前未自行改该 owner 的测试/生产实现。本环境没有向旧 owner 线程发消息的工具，已报根安排窄任务；[未应用的四处共享读取建议](windows-readback-fixture-suggestion.patch) 通过 git apply --check，供该 owner 审阅，不冒充已修复或 Windows 已通过。
2. 视觉 owner 继续核字体、表格字重和报表显示格式，收到明确交付后再接入。当前已通过的六项旧窗口、两项原生键盘焦点和九项资源检查需要在最终视觉/夹具组合上确认，不把旧截图当作后续源码的结果。
3. 实际完整 Desktop 安装器/升级尚未执行：现有 Desktop `managedDataContract=false`，且暂停门槛禁止生成新分发包。已跑合成受管 CLI/文件保留和共享保护，不声称完成实际安装器闭环。保留暂停标记、更新禁用和账套保护。
4. 物理键盘/中文 IME、多 DPI/多显示器焦点、NTFS 断电/恢复尚未运行。没有权限审批待办；上述是技术验证与已限定阶段范围，未采用绕过路径。

整体通过 PR16 审阅接到目标开发分支，先核远端最新头；不要覆盖他人分支或重复拣选基线已有 Core/Contracts/Controls/独审修复。不合 main、不改权限、不公开、不发布安装器。文档/原始证据后续保存提交不改变代码；交接时同时给代码 SHA 和最终文档 SHA，并以树比较说明关系。
