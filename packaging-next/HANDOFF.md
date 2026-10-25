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
