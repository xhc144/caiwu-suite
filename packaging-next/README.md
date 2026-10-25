# Windows 交付与验收候选实现

本目录是独立交付组件，供主协调采纳。只增加 `packaging-next/**` 与 `tests/Caiwu.Delivery.Tests/**`；不改原 `packaging/`、根 solution 或 `.github/`。源起点 `037a07585078d4dfcd443a2cc4a237c88aed07a0`，公共接口沿用 `97d696a3ee7adf100e24b4924438468bd34dd80c`。

## 已实现与门槛

- .NET 10 LTS / WPF / Windows x64 自包含发布，NSIS 3.13 当前用户安装器、开始菜单、ARP 卸载登记和便携 ZIP。无需管理员权限；不写 HKLM、不安装服务、不更改安全设置。
- 显式四段 Windows 版本、完整源码 commit、固定 SDK/runtime、NuGet content hashes/锁文件、固定 NSIS/SCons 下载 SHA256、固定构建时间和有序 ZIP；逐文件清单与发布校验。默认拒绝脏源码和未锁定依赖。
- 程序版本目录不可覆盖，`current.json` 是原子激活点。数据根保留绑定安装根、版本和 payload 摘要的回执，阻断换安装根或卸载后换包绕过升级；卸载后仅相同 payload 可在原根重装。安装及卸载与程序启动共享租约；相同数据根另有全局租约，避免两处安装同时写同一组账套。
- 卸载只删除清单中仍匹配原 SHA256 的程序文件。未知文件、被修改的程序文件、账套与备份保留，不递归删程序根。程序根有未知文件或回执不一致时，重装/迁移目录需要显式恢复流程。默认数据根 `%LOCALAPPDATA%\CaiwuSuite\Data` 与程序根 `%LOCALAPPDATA%\Programs\CaiwuSuite` 分离；支持 `/DATAROOT=`，并拒绝程序/数据/临时 payload 嵌套和 reparse points。
- 升级组件以 SQLite Backup API 为每个已登记账套生成一致性备份，并从备份回读 book/revision 和校验值。迁移回调只收到恢复出的副本；损坏或异常会阻断激活，原账套与旧指针不动，备份及回执保留。
- 自动检查/下载组件支持 HTTPS 精确主机白名单、无重定向、有界 feed/下载、单调版本与 SHA256。Windows 另以可信 Authenticode、固定发布者指纹、签名包产品名/实际版本核对。下载只产生 `.untrusted`；通过签名后可生成等待用户审批的 `.exe`，不会自动执行。

**真实 Desktop 尚未完成账套登记和统一入口集成，实际包的 `managedDataContract=false`。因此首次安装可用，覆盖升级会在激活前阻断。** 不应手改标记来绕过。数据回执与激活指针之间发生断电时须核对两份回执并走显式恢复；不声称已完成断电恢复测试。当前仅支持 schema 1；已实现迁移副本验证门槛，没有实现生产账套原地 schema 迁移或自动数据回退。

**包未签名、无可信发布通道，`update-policy.json` 默认 disabled。** 自动更新应用的完整闭环尚未完成；不能把任意 URL 的下载/执行当成功。不会生成、索取或导入证书/私钥，也不购买许可。签名正向验收、可信 feed 托管与审批后的应用流程由发布负责人接入。

## 构建

先准备仓库固定的官方 SDK 10.0.402。Linux 可沿用 `tools/dotnet-local.sh` 的工作区缓存环境。官方 SDK 的 SHA512 位于既有 `docs/sdk-metadata.json`。目标 runtime 为 10.0.13；工具维护时整体审查与更新锁，不悄悄浮动版本。

Windows 自带 Python 3.11+ 和固定 SDK 后：

```powershell
python packaging-next/bootstrap-nsis.py --destination .tools/nsis
python packaging-next/build.py --version 0.1.0.1 --makensis .tools/nsis/nsis-3.13/makensis.exe --out artifacts/delivery/first
```

Linux 已有 Python 3.11+、g++、zlib 头文件时可原生构建 compiler，使用官方 Windows stubs，无需 Wine：

```bash
python3 packaging-next/bootstrap-nsis.py --destination .tools/nsis --native
python3 packaging-next/build.py --version 0.1.0.1 --dotnet ./tools/dotnet-local.sh \
  --makensis .tools/nsis/nsis-3.13/Bin/makensis --out artifacts/delivery/first
```

输出目录必须为空，脚本不删除旧交付。`--allow-dirty` 只用于本地预览，并在 provenance 标记；`--refresh-locks` 是显式维护操作，首次改变包图时才使用，之后检查新增锁文件。Desktop RID 和 helper SingleFile 的依赖图分开放在 `packaging-next/locks/desktop/` 与 `helper/`（SingleFile 会添加 ILLink build 依赖），所有图锁写入 `packaging-next/locks/`，不改其他 owner 的 NuGet 锁。

交付包含 `*-setup.exe`、`*-portable.zip`、`release-manifest.json`、`SHA256SUMS`、`payload/payload-manifest.json`。清单记录源 commit、版本、工具与每个文件长度/SHA256。清单不是数字签名，不能单独建立发布者信任。

同一源提交与工具可重复构建到另一个空输出目录，比较 installer/ZIP SHA256；建议在干净 runner 重复。`SOURCE_DATE_EPOCH` 来自源 commit。Linux 的可重复性证据不等于不同 OS/compiler 二进制必然相同，签名和可信时间戳亦是后续独立发布步骤。

## 安装、卸载和 Windows 验收

安装器为当前用户安装。交互默认不显示账套根选择页，可用明确参数选择分离的目录：

```powershell
.\caiwu-0.1.0.1-win-x64-setup.exe /S /DATAROOT="D:\CaiwuData" /D=C:\Users\Example\AppData\Local\Programs\CaiwuSuite
```

NSIS `/D=` 必须最后且不加引号。实际运行优先使用开始菜单的统一 launcher。便携包保留 `.NET` 全部 runtime；直接启动 Desktop 会绕过交付租约，因此不能据此开启安全升级。

本机没有 Windows/Wine，不运行任何 Windows EXE。Windows 验收脚本只启动本仓库自研程序，使用全新隔离目录和合成账套，并在发现已有该产品 ARP 登记时停止。它检查 native 安装、实际 WPF 截图、租约阻断、未集成升级保留、未签名更新拒绝和卸载保留数据：

```powershell
./packaging-next/Test-WindowsDelivery.ps1 -Installer artifacts/delivery/first/caiwu-0.1.0.1-win-x64-setup.exe `
  -UpgradeInstaller artifacts/delivery/next/caiwu-0.1.0.2-win-x64-setup.exe `
  -OutputDirectory "$env:RUNNER_TEMP/caiwu-delivery-unique-run"
```

验收的安装包版本固定为 0.1.0.1 和 0.1.0.2。卸载测试使用 NSIS `_?=` 在原进程运行，以便可靠等待真实退出；运行中的卸载 stub 本身可能留下，外部合成 unknown 文件按设计保留。正常用户卸载采用 NSIS 临时副本机制。

候选 workflow 在 `workflows/windows-delivery.yml`；仅主协调可采纳到根 `.github/workflows/`。未被采纳前 GitHub 不会执行它。Windows CI 生成 `windows-acceptance.json` 和真实 WPF 截图；人工键盘流、DPI、打印、签名正向与生产合规不属于已完成验证。

## 给 Desktop/存储 owner 的接口

1. 所有生产启动均走 `Installation.Launch(installRoot,args)`，持 install 和 data 两个租约直到 WPF 退出。若 owner 将租约直接移入 Desktop，请保持相同锁文件与 FileShare.None 规则。`CAIWU_DATA_ROOT` 会传给 Desktop，当前 Desktop 尚未消费它。
2. 只能在数据根中创建/打开受管 `.caiwu`，每次打开前先原子登记 `dataRoot/managed-books.json`：`{"contractVersion":1,"databasePaths":["绝对账套路径"]}`。拒绝漏项、外部路径、重复、链接和备用目录；所有已有账套必须纳入迁移/导入方案。**扫描受管根无法证明根外没有账套，需 Desktop 按实际打开/创建路径履约。**
3. 产品集成并独立验收后，才让 `PayloadManifest.Create(..., managedDataContract:true)` 同时用于旧版与新版。当前 CLI 故意不暴露开启开关；不得仅改 JSON 解锁。
4. 当前 `UpgradeSafety.Prepare(dataRoot,paths,migrateStaged)` 必须在租约内调用，返回备份目录、staged 副本和回执。只允许迁移副本。将来 schema 改变时，另设计跨文件日志与可恢复提交，并由存储 owner 验证恢复流程；不能把这个阶段误称为已支持原地 schema 升降级。
5. 更新 API：`UpdateClient.CheckAsync` 供启动/空闲时自动检查，`DownloadAsync` 仅做有界 hash 验证；`Stage-TrustedUpdate.ps1` 做 Windows 签名审批并返回待审批路径。`Assert-TrustedInstaller.ps1` 可在实际应用前再次校验签名、hash、产品与实际版本。没有安装后置健康检查/失败应用回退的 unattended apply 实现，当前应由用户手动确认后交安装器处理，升级数据门槛仍生效。

CLI 均为位置参数：`manifest payload version commit`、`verify payload`、`install payload installRoot dataRoot`、`launch installRoot [Desktop args...]`、`uninstall installRoot`、`check-update policy currentVersion`、`stage-update policy currentVersion stagingRoot`。更新策略由可信安装配置提供；feed 不能自行增补主机或发布者指纹。

## 许可与证据

.NET 官方元数据确认 10.0 为 LTS，支持期至 2028-11-14：[Microsoft metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json)。NSIS 3.13 使用官方未改 stubs 与 zlib compressor，核心/zlib 的 zlib/libpng 许可允许商业使用，无购买要求；保留原 notices、不冒称上游作者、不把修改版冒作原版：[NSIS license](https://nsis.sourceforge.io/License)。未选择 LZMA、付费工具或第三方 installer plugins。

`THIRD-PARTY-NOTICES.md`、`NSIS-COPYING.txt`、`licenses/Apache-2.0.txt` 及构建时从官方 runtime pack 复制的许可证随包保留。锁定 NuGet 的原始 license expression 已核实。工具本地编译证据为 `toolchain-evidence.linux.json`；它记录本轮观测，不冒充官方数字签名或 Windows 运行验收。
