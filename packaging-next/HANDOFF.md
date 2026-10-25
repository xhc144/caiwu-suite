# 交付任务交接（2026-10-25）

项目：私有 xhc144/caiwu-suite；开发分支 codex/windows-delivery；起点 037a07585078d4dfcd443a2cc4a237c88aed07a0。公共契约仍为97d696a3ee7adf100e24b4924438468bd34dd80c。本任务只增加 packaging-next/** 和 tests/Caiwu.Delivery.Tests/**，无其他 ownership 修改。

## 已有直接证据

- success：官方 SDK 10.0.402 下载 SHA512 与仓库官方元数据一致，.NET 10.0.13 在Linux运行。交付项目构建零警告、零错误。
- success：80项自研合成测试通过，无失败、无跳过；包括SQLite WAL一致性备份、迁移异常/损坏副本保护、目录分离、漏清单、安装租约、卸载保留、跨根及缺pointer绕过回归、离线HTTP不可信来源/重定向/流大小/hash/取消等。逐项报告由测试程序输出到 artifacts/delivery-tests.json 或构建输出目录。
- success：官方NSIS3.13 source+zip与固定SHA256均已验证；固定SCons4.11.1 wheel与官方PyPI元数据一致。bootstrap-nsis.py --native实际完成原生compiler构建；未运行Windows EXE。
- success：实际生成.NET10 WPF win-x64自包含payload、Windows NSIS安装器与便携ZIP。一次初版installer为129,504,320 bytes，后续增加安全回执及notices会改变大小/hash。最终以所选干净源commit的release-manifest.json与SHA256SUMS为准，不把早期脏树产物冒称正式包。
- success：普通WindowsDesktop RID图与SingleFile helper图已分开锁，原因是后者为同一引用项目引入ILLink.Tasks；初次共用锁曾NU1004失败。未关闭locked mode；显式维护生成两套锁后构建已通过，常规构建继续使用--locked-mode。
- unverified：Windows native安装/ARP/快捷方式/卸载、实际WPF运行、PowerShell Authenticode正向/负向与人工键盘/DPI/打印。Linux构建成功不证明这些完成。候选workflow仅放packaging-next/workflows，主协调尚未采纳到根.github，因此本任务不能宣称已跑Windows CI。

## 有用文件及置信度

- high：src/Caiwu.Delivery/{SafePaths,PayloadManifest,Installation}.cs，受管路径、文件校验、不可覆盖版本、租约、原子pointer、数据根绑定回执、保留式卸载；80项中相关真实组件用例支持。
- high：src/Caiwu.Delivery/UpgradeSafety.cs，通过既有SqliteLedgerStore生成一致性备份与可验证stage，故障保留原件及备份；含真实SQLite/WAL与副本迁移测试。
- high：src/Caiwu.Delivery/Updates.cs，自动检查和仅下载暂存组件；默认关闭，无重定向与有界流；离线HTTP测试支持，不代表已连接可信feed。
- medium：installer/Caiwu.nsi，真实全payload编译通过；runtime行为须Windows验收。NSIS仅作为成熟zlib许可包装，调用自研安全组件，不递归删除账套。
- medium：Assert-TrustedInstaller.ps1、Stage-TrustedUpdate.ps1，Windows签名链+pin+hash+实际版本门槛，不执行安装器；本Linux未实际执行PowerShell签名检查。
- medium：Test-WindowsDelivery.ps1、workflows/windows-delivery.yml，隔离自研Windows验收入口及采纳提案，尚未Windows实跑。
- high：toolchain.lock.json、Delivery.restore.targets、locks/**、bootstrap-nsis.py、build.py，官方工具/包锁和真实构建路径；无系统安装/签名/公开发布步骤。

## 主协调需要接入

1. Desktop全程持同一install/data租约、消费CAIWU_DATA_ROOT、按每次实际创建/打开路径原子维护managed-books.json，并限制或迁入根外账套。当前真实包ManagedDataContract=false，所有覆盖升级继续阻断。
2. 当前schema1；迁移只在备份副本上验证。将来生产schema更改必须由存储owner另做journal/可恢复提交及回退测试。本实现没有原地迁移/自动schema回退。
3. 两份交付回执遇断电可能需显式恢复；原账套和版本目录保留，不声称断电恢复已验。未知文件/改动文件留存会要求人工恢复程序目录；不自动清理保留数据。
4. 采纳workflow到根.github后，在干净Windows runner执行native安装、WPF截图、升级阻断、未签名拒绝和卸载保留验收。
5. 既有可信签名设施、可控HTTPS feed、发布者pin与人工审批前置到位后再启用检查/暂存；当前无自动应用更新闭环。没有生成/索取密钥证书，没有导入信任、购买许可、改安全设置或访问真实账务。

本轮没有审批拒绝、没有参考安装器执行，也没有公开发布。分支/草稿PR若成功，准确链接由任务最终回复提供；不会合入main。

## 最终干净构建与远端交付

- 实现提交：`983e2e31ee9f66a4204dcddc154c1a0ab097d4f9`，已推送私有 `codex/windows-delivery`，草稿PR为 https://github.com/xhc144/caiwu-suite/pull/6 ，base仍是codex/windows-mvp；未合main。
- 两个独立干净源码目录（原工作区与detached clean worktree）使用常规locked mode完整发布成功，安装器、便携包及payload manifest字节相同。`evidence/983e2e3/`提交准确manifest、80项逐项报告、SHA256SUMS与reproducibility.json。二进制按该实现提交构建，后续本交接/证据提交不属于该产物的源commit。
- Installer 129,530,445 bytes；SHA256 `468d959f23d8e7d301de975d5f139a9d78412305030d59905dd9760d421fefbe`。Portable ZIP 225,085,301 bytes；SHA256 `2ac2533b537f7ff33a1558e0cc57733fc27d9d64144c8e7f4f80bd6488316441`。标准SHA256SUMS校验全部通过。
- 本环境二进制及报告：`artifacts/delivery/clean-first/`。另有聚合ZIP `artifacts/delivery/caiwu-windows-delivery-983e2e3.zip`，354,698,701 bytes，SHA256 `f4e805d9fcf5fa7264986e9e1684c1d1aece6d2edb34be6d73372e664d778218`，包含installer/portable/manifest/tests/rebuild证据。
- Library保存 blocked，结果已知未执行上传：当前技能的library_upload.py在hosted apps tools/list返回HTTP401，尚未进行prepare/transfer/finalize；无Library文件ID，无部分上传或不确定结果。未改用direct upload，因为Library技能明确禁止开始helper流程后切换direct action。此为助手鉴权错误，并非自动审批拒绝；后续仅在helper鉴权修复后重试相同文件，不盲目重复。该阻断不影响已完成私有分支/草稿PR与可复现源码交付。

## 有限 Windows 验收准备续作

- 按用户续令，只改 delivery/test ownership，未重试 Library401，也没有换上传路径；旧包仍保留。主集成已在不可变 `0377ce764bc5a191c232c3f50da602a5ca2c0c0c` 暂停分发。发现后本模块在 build.py/workflow 加同等暂停门槛，无绕过开关；不再生成新分发包以替代独审复查。
- 原Windows脚本两处不足已修：busy测试从人为持锁改成真实安装 launcher+WPF 窗口在用时调用native升级；新增安装目录工具的SQLite inspect/backup/restore语义验证和卸载后三类文件SHA保留。全部runtime命令均来自安装目录，不运行源项目或参考EXE。
- 新 `BookOperations`/CLI 显式单账套命令内部持两租约，只向新的backup/recovered文件写入，不覆盖、拒越界/链接。该工具没有声明完整Desktop登记或开启升级；辅助银行余额对歧义同名账户返回null。
- success：110项.NET10组件/托管CLI回归通过；Linux上托管CLI实际子进程含中文/空格路径、错误参数、危险目标及跨进程租约。明确publishedWindowsArtifactExecuted=false。
- success：官方PowerShell7.6.7 Linux tarball实际下载，对照官方GitHub资产SHA256验证；标准XDG缓存放工作区，未改HOME/系统。PowerShell parser验证3个交付脚本，抽取真实Same-Book断言做7个独立正确/错误值检查通过；4个Python暂停门槛测试通过（含确保任何tool/output产生前阻断）。这些不是Windows行为实测。
- 具体主Desktop文件/方法/最小改法已合并进README的适配表，尤其指出launcher已持锁时Desktop不能再次获取同名非共享锁；恢复副本要正式Open/登记。最新主packaging已有通用Exe测试调度，不再提出过时的文件名白名单要求。
- unverified：Windows native安装、真实窗口忙态、安装EXE备份恢复、签名门槛与卸载均待GitHub Windows runner。在暂停独审门槛存在时，候选workflow故意不产新包、不启动安装验收。严格managedDesktop输入只读观察真实清单，不制造清单或切换标记；正向版本升级依然未完成。
- success：在隔离worktree只把本模块两目录覆盖到主集成不可变0377ce764bc5a191c232c3f50da602a5ca2c0c0c，针对其最新Contracts（含ExpectedRevision）和SQLite再次跑相同110项，全部通过；其他owner源码未改。该worktree真实暂停文件也实际阻断build.py，且在任何tool执行或输出目录创建前返回非零。
- evidence/windows-harness-preparation记录两份110项报告、官方PowerShell下载证据及验证摘要。候选workflow的true/false两个严格模式渲染后共14个PowerShell run块均解析通过。窗口忙态probe同时校对实际安装路径、非零窗口句柄与已核对的主窗口标题，避免把启动错误消息框算作主窗口成功。

## 独立安装/备份边界安全复核

- 以87b3fbf2a5141088d490be807ccb3bdb57d56d7f为本轮基线，先只跑15个不同新条件，实测11项失败；不是把原110项重复计数。之后另复现“只读有效备份已复制后却报失败”和“只读备份目录被错误要求可写”两个独立条件。
- 已修：独立VersionManifests所有权摘要与全量卸载预检；未知版本/目录/链接保留；删除前pending+去激活；data-only租约与中断凭据的公共启动/卸载门槛；migration BookId/revision绑定；只读schema-v1对象门槛拒trigger/view等；只读备份一致性inspection copy和独立scratch目录。账套后缀和-journal不得进入程序payload。
- success：22个新增边界全部通过，最终全量132/132、无失败无跳过；副作用断言实际核对用户账套/未知文件、有效备份哈希、程序/指针/回执及POSIX自写启动sentinel。额外权限测试只作用于唯一fixture并恢复，不改系统安全。完整前后JSON在evidence/security-boundary-review。
- 恶意trigger独立控制：完整性仍ok，直接Storage恢复后普通snapshot保存将期初1234.56改成61234.56。本模块拒绝这类对象，但主Desktop当前直接Storage Open/RestoreBackup仍需在App.OnStartup的委托包装中调用公共LedgerFilePolicy.Validate；不将本模块修复冒称全App已安全。
- unverified：Windows原生安装/卸载、NTFS junction/ACL/8.3、硬链接身份、同用户恶意并发换目录及真实断电；只对Windows namespace做词法拒绝，不能当NTFS实测。保留独审暂停门槛，没有新分发包、Library重试、签名/更新权限扩展或main合并。
- 兼容/恢复门槛：旧预览若没有独立版本摘要则拒绝自动卸载/更新，不能从现存manifest反推信任；pending卸载需显式恢复，没有自动继续或断电恢复完成声明。备份布局校验不证明数据来源真实性，指定账套恢复仍需UI核对期望BookId/已知可信hash。

## schema-v1约束复核续作

- 收到候选后先核源码：accounts“先正确读、再位置INSERT交换列”说法已由主协调撤回；ReadContents确实SELECT*按序读，撤回被保留，不据此改规则或数据。另只读核对主集成cf334c93aca6c33f48411ceea77d7044c1bf161f，其Storage仍为该读写方式，生产源码未改。
- 真正C#反例：voucher_lines额外UNIQUE(summary) ON CONFLICT REPLACE，所有列序/类型/PK/FK及5表名不变、autoindex.sql=NULL。旧Gate与Delivery Restore实际通过；随后正常Storage.Write两分录借贷各10.25，读回只一贷方行10.25，revision2，integrity ok/FK empty。原输入和两个backup hash不变。定向初版4项2失败，完整证据已保存。
- 只改本模块：SchemaV1Layout以可信Store.Create新建的规范v1空库为参考，对完整表/索引DDL受限token、table_xinfo、FK、STRICT/withoutrowid、index_list/xinfo比对；在同一只读输入事务内完成，不迁移/改写输入，失败不建恢复目标。临时参考不是用户账套，创建后只删自身文件。
- 第二实际发现：首版normalizer误在CR结束--注释，SQLite实际上直到LF；负ordinal控制证实CHECK已缺失但旧norm仍通过。按官方SQLite规则修复LF边界并限制未引用token为审阅过的ASCII，未按猜测修其他业务规则。
- success：新增9/9、全量141/141，无失败无跳过；canonical空白/闭合注释兼容控制仍可恢复且保存两条完整平衡分录。evidence/schema-constraint-review含原Gate失败、CR失败、修复后和全量JSON。
- root分工建议：Storage Open/Restore要拒绝未知schema；Create/InsertContents用显式列名，ReadContents用显式投影；Write在commit前深语义读回数量与完整分录/借贷，不匹配回滚。显式列名本身不阻止ON CONFLICT REPLACE，不得当成此bug单独修复。Delivery的公共Validate可在Desktop组合根预接，其他直接Storage入口不自动受保护。
- 兼容仅规范schema-v1及已说明的cosmetic差异，未审阅DDL需显式迁移，不静默转换合法数据；Windows/发布签名/生产迁移未验，分发暂停、无Library重试和不扩大更新权限仍保持。
