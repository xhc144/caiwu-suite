# 独立 Windows 复验阶段交接

阶段截止前保存；交付暂停不解除。代码组合为 `d0e32bbb2a16156ed98f6fea9967fc5f4e954d9b`（源码树见本报告旁的 `windows-revalidation-provenance.json`）。远端已完成实跑版本仍是 `6a4683955267306f8eb9544635560d214b5921f9`，详见 [实际 Windows 失败报告](windows-40177493350.md)。新增授权证据后组合及证据已推送 `fa463b716e1fea5b3e413dae412d1405457f95a0`，草稿 [PR13](https://github.com/xhc144/caiwu-suite/pull/13) 已创建；新CI尚未验完。

## 可拣选改动

| 本地提交 | 内容 | 依赖/限制 |
|---|---|---|
| `7b4638f` | App Open/Restore委托先调用公共LedgerFilePolicy.Validate，Desktop引用Delivery | 在现有独立Windows组合中已提交；直接Storage仍不能替代公共入口保护 |
| `20ff5003475d849e5792e756c54deae11c9352ae` | 作者Delivery `ef17e64d18f7bc85fd6cfe452d1d0418b018f568` 原补丁 | 4个C# blob与远端相同；通过只读连接器导入，不冒称原生cherry-pick |
| `b77272bf377567c289c0ded4455b326b9326e9dc` | 作者Storage `ecc5225f7aaf9e9d0fd79c13a8a14059dde6df4b` 原补丁 | 生产blob `eaf5aa6508ddb1e89d2a5faac3b66bc01a1c2c05` 完全一致 |
| `f57438e38bcbb04916b47a5e5e780f3861670179` | Desktop v1.2 UI接线、会话代次保护、新建账套取消路径保留、合成夹具适配 | 需要Contracts bb76658、Core6662120；不改这两个生产模块 |
| `3594b4115ed9cad23dc58c98975ff37902a3efd7` | 报表联查关闭/返回后保留筛选、业务行选择、双向滚动 | 独立Windows导航探针尚未执行 |
| `4d44bc7949e21c8264c5172e9d2eba71e662434d`、`1d5ab261ba4963a9f5f67586dd011a4fd76fb2ea` | 两个历史恶意schema控制项，改验新Storage完整拒绝回滚 | 原Linux组合失败记录保留；其他安全断言未删 |
| `9e1ead0d7276ab748a56925f7561f9568b6866fa` | 独立v1.2 22项、WPF8/双进程适配、导航探针导入、四页原生截图入口、CI独立步骤 | 导航探针源0f8fb850，仅迁移合成夹具上下文；未Windows执行 |
| `5af3d8ef08adb53069a0c6327532008e064d65b2`、`ec354e1` | 六个真实窗口旧操作/同身份恢复探针及实际ComboBox类型修正 | 仅交叉编译，未Windows执行 |

组合此前还包括 Core53、独审49de1be、Controls633cfb9+bf75d56、Delivery8e989及必要前置；Core v1.2契约/Core/证据分别本地 `866d6a7`/`f18fbe3`/`866bee7`，来源分别 `bb76658c19df94ab79e257db076d2ac8a39b7997`、`66621203066488c7e7a4115ede508e88ec58e3fa`、`b2f59e3c93c7b97e64c17feb9b77d0b71da2b964`。Core生产blob `ec873a80c12486a792f627acedcee4b960d0a983` 与6662120一致。没有纳入Nonprofit38533de或7b8e8b7。

UI在加载/编辑开始时把实际显示快照和打开会话绑定。保存/重试不补取新token；Preview包装原样转发上下文。旧窗口在切账或恢复相同BookId/Revision副本后仍会被会话代次/服务实例检查拒绝。审核/记账/删除来自显示行，期初和科目来自显示表单；冲突不重载输入。查询按钮是显式重载完整数据和上下文的入口。

## 独立本地验证

环境为 Debian13、官方.NET SDK10.0.402/.NET10.0.13、真实SQLite。以下口径不同，不能相加当一个总用例数。

- 独立v1.2：22/22。五个旧输入、8个无上下文API、新凭证缺字段、异账套同revision+同ID、不存在ID、Preview不替换上下文、同身份恢复/失败打开/关后重开代次保护。拒绝前后比较完整快照，含audit/revision。代码链接实际Desktop Session/Preview文件，不是WPF运行。
- Core单测149/149；Storage109/109；Reporting真实Core/SQLite集成9/9。
- Desktop逻辑可执行探针28断言、实际SQLite/Core/session集成12断言通过。它们是exe，记录的是实际 `dotnet run`，不是无测试执行的 `dotnet test` 返回码。
- Delivery schema定向9/9，完整141/141，真实自写managed CLI子进程也运行。初次完整136/5中4项是SDK目录未进入子进程PATH、1项是新Storage提前拒绝旧破坏控制；两种原因及初始JSON保留。修正PATH与控制预期后全量通过。
- 全根solution、WPF8、双进程、导航、六项MutationWindows、HighResolution交叉构建成功，零警错；YAML可解析。PowerShell runner本地未执行。

证据在 `tests/Caiwu.Acceptance/evidence/v12-local-independent-final.json`、`v12-test-results/**`。较早的 `v12-local-independent.json` 没有组合commit，保留为早期记录，不用作最终不可变源码证据。

## 下一Windows任务入口

源码干净的Windows checkout上，以该组合运行现有 `.github/workflows/windows-build.yml`。所有独立UI步骤均 `if: always()`；Delivery失败仍保持job红，不会再饿死UI取证。保留pause gate、parser及无分发包检查，未改权限/原包/main，未发布Release。

1. `pwsh -NoProfile -File tests/Caiwu.Acceptance/HighResolution/run.ps1 -OutputDirectory artifacts/high-resolution`：实际App backend、合成账套，主窗/可编辑凭证/明细账/报表各一张原始PNG。尝试原生1920×1080桌面；不支持则明确BLOCKED。用原生BitBlt而非拉伸，记录真实窗口DPI、像素尺寸/hash；尚无运行结果。
2. `tests/Caiwu.Acceptance/Wpf/run.ps1`：8项布局/输入/错误/重复保存/忙锁/已记账/账户/旧草稿。
3. `tests/Caiwu.UiNavigation.Tests/run.ps1`：真实原生保存位置取消与报表联查/返回，两项。
4. `tests/Caiwu.Acceptance/MutationWindows/run.ps1`：6项实际MainWindow调用：期初活动单元格、科目表单、删除、审核、确认10而新值20的记账、相同账套身份/版本恢复后的旧编辑器。仅点击本进程原生确认框，不碰其他程序。
5. `tests/Caiwu.Acceptance/DualWindows/run.ps1`：两个真实应用进程及公共Open/Restore gate；重验Pooling=false夹具。
6. Delivery需优先修复/重验 Windows 文件共享故障，不能用Linux141通过解除门槛。物理中文IME/真实键盘焦点、多DPI与NTFS断电另行验，不从脚本输入推定。

## 审批状态与剩余阻断

**历史拒绝，现已解除**：为私库 `xhc144/caiwu-suite` 的 `codex/windows-revalidation` 向 `codex/windows-mvp` 创建草稿PR。首次自动审批原文：

> Creating a draft PR is an external commitment, and although draft PRs were authorized generally, the user explicitly restricted work to branch codex/independent-acceptance; this request targets codex/windows-revalidation instead.

首次拒绝后停止远端写入。根随后转来带2026-10-25 06:53:24/06:56:11 UTC时间戳的新证据，明确覆盖本项目新软件私有开发分支提交推送与草稿PR。核查此head/base没有既有PR后，09:20 UTC普通git push成功，再用相同GitHub创建接口仅重试一次，返回PR13、draft=true、head=fa463b7、base=codex/windows-mvp，确认执行成功。未换工具绕拒、未改权限/凭据/可见性。

PR创建时目标基线已前进至 `a49d426d8513600dec0f624f56a35c9ad66e71d4`，连接器初始返回mergeable=false；09:22原生只读查询随后明确为MERGEABLE。因此初始布尔值不能作为实际冲突证据。下一短任务需协调视觉专责新XAML，再执行新视觉版本截图；本阶段不抢改视觉、不合main。已有高清入口当前针对行为基线，不能当作新视觉验收截图。视觉合并须保留期初金额的UpdateSourceTrigger=PropertyChanged及报表BackButton/Back_Click行为绑定。

**另一个仍待许可的事项**：原资源派生完整catalog上传被根报告审批拒绝。旧主工作树 `/workspace/caiwu-acceptance` 的 `docs/reference-ui/static-templates/**` 本地输出仍保留，未复制到此组合、未上传。不能把普通新软件代码许可当作这些派生数据的分发许可。

最后截图探针修正仅影响自研测试：选择1002银行账以显示实际合成发生额，并检查待拍窗口是原生前台窗口。该改动交叉构建通过，尚未Windows执行；独立22项证据仍精确指向c70cd966，其生产src树与最新组合一致。
