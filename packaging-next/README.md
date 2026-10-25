# Windows 私有交付组件

> **12:35 UTC阶段更新：**root已明确批准私有生产构建及实际安装生命周期验证。旧 DELIVERY_PAUSED 已转换为 `docs/acceptance/PRIVATE_VALIDATION_ONLY.md`，新workflow已采纳，新的完整SHA及结果单独冻结。用户分发和Release仍未批准；两路QA的审核SHA仍待root回传。以下原有暂停/待采纳表述是上一阶段记录，以本更新及分项门禁记录的最新授权为准。


**交付仍暂停。** `docs/acceptance/DELIVERY_PAUSED.md` 由指定独审负责；只有根接受旧 P1 复查和最新证据并明确放行后，才可处理标记、生成最终用户候选。普通 builder 没有暂停绕过参数。现有内部安装器不是最终包，不能改名交付。

当前基线为 PR30 head `2707a72ffe1b73fed715517802e6ad62e48fe611`。实际 Windows 安装验证的代码源是 `dece298946d03ad88c5031eb02dab8f87c330046`；其正常登录、独立审核/记账、F10 取消/接受、实际恢复目标深回读、忙态阻断、正常升级及升级后登录、卸载保留的精确范围见 [候选交接](RELEASE_CANDIDATE_HANDOFF.md)。历史失败也在该记录保留，构建或组件绿色不替代安装业务验收。

本轮生产路径、源码/文件冻结、两路安装业务 QA 等待项和最终重建顺序见 [最终私有交付方案](FINAL_PRIVATE_DELIVERY_PLAN.md)。用户安装与操作说明见 [中文指南](../docs/user-guide/INSTALL_AND_USE.zh-CN.md)，分层验收边界见 [验收矩阵](../docs/user-guide/ACCEPTANCE_MATRIX.md)。

## 构建路径

- `Prepare-WindowsCandidate.ps1` 在干净源进行 locked 自包含 Desktop/host 发布，记录精确源与逐文件 hash，不生成 installer/ZIP，暂停期间可用。
- `Build-InternalQa.ps1` 仅在隔离 Windows CI、hold 仍存在时生成 `INTERNAL-UNVALIDATED` 合成 QA 安装器。测试控制器生成它的 managed manifest；不属于最终生产路径。
- `build.py` 使用组合宿主作为安装引擎及 installed launcher，四类原生 codec 与真实租约保持完整。显式 `--managed-data-contract --expected-commit <完整SHA>` 才采用已审核的受管 capability；普通 `manifest` 默认仍为 false。该生产选项要求干净源和冻结锁图，并仍先检查 hold。未指定选项的旧 false 路径不适用于当前受管快捷方式，不应交付。
- `freeze-source.py` 只从指定提交的 Git blob 生成冻结文件清单；不复制源码或读取未跟踪数据。

固定 SDK10.0.402/runtime10.0.13，RID 为 win-x64；官方 SDK SHA512 见 `docs/sdk-metadata.json`，NSIS3.13 来源及 SHA256 见 `toolchain.lock.json`，`bootstrap-nsis.py` 负责验证下载。Desktop 和组合 host 的 RID 图分别由 `packaging-next/locks/desktop`、`host` 冻结，源 owner 的锁文件不被重写。

放行后的命令、版本选择与 Windows 实测步骤以最终方案为准。输出包括 `*-setup.exe`、用于核对的 `*-payload.zip`、`release-manifest.json`、`SHA256SUMS` 和 `payload/payload-manifest.json`。ZIP 不是受支持的免安装应用；受管 App 需要安装激活、可信回执和独立数据根。中文指南及第三方/runtime 许可随 payload 保留。清单 hash 不等于数字签名。

## 安装与数据边界

当前用户安装默认程序根 `%LOCALAPPDATA%\Programs\CaiwuSuite`、数据根 `%LOCALAPPDATA%\CaiwuSuite\Data`。程序、数据和临时 payload 必须分离。自定义静默安装的 `/DATAROOT=` 指定数据根，NSIS `/D=` 指定程序根且放最后；实际启动走快捷方式或 `Caiwu.Delivery.exe launch-managed "<installRoot>"`。Desktop 在访问任何身份/账套数据前校验实际执行路径及 owner/current/data receipt，并拥有 install/data 两个 OS 租约。不要直接启动 Desktop、删锁或改 JSON 解决拒绝。

版本目录不可覆盖；升级在租约内对全部已登记账套及原生附件完整备份、验证后激活新指针。旧版、新版都必须真实声明 managed capability。单账套备份不含全局操作员，身份备份需独立受控流程；活动 Global/Operators 不被账套恢复覆盖。

恢复仅支持本数据根内原路径可信备份的恢复副本。原 bundle+receipt 移至新根，在原路径不可用时会安全拒绝；**跨根便携恢复/导入重映射未实现**。卸载按独立所有权 hash 删除已知程序文件，保留账套、备份、身份、未知和被修改文件。未知旧预览、schema 迁移、中断/断电恢复需单独处理，不能承诺自动回退。

## 验证与信任

`Test-WindowsDelivery.ps1` 只在隔离 x64 Windows CI 运行合成验证。默认内部模式要求 hold 与 INTERNAL marker；`-ProductionCandidate` 要求 hold 已由 owner 处理、完整 approved SHA 与干净源匹配，并拒绝内部 marker。该模式未自行批准交付。它从新安装目录执行产品、核对真实恢复目标和每个观测保留文件；不从源码项目冒充安装产品。

[候选准备 workflow](../.github/workflows/windows-candidate-validation.yml) 可在暂停期间运行，不产分发文件。`workflows/windows-delivery.yml` 是放行后待采纳的模板，并未成为活动交付 workflow。`Test-WindowsHarness.ps1` 检查 PowerShell 语法和实际正负断言，`test_build_gate.py` 检查暂停与显式 source/capability 门槛。

包仍未签名，`update-policy.json` 默认 disabled，无可信生产自动更新源。保留 HTTPS/白名单/下载边界与 Authenticode 发布者、产品/实际版本门槛；不生成签名材料、凭据或更改 Windows 信任，不自动执行下载。

较早接口/安全边界审查与实测记录见 [HANDOFF](HANDOFF.md)、[MANAGED_MODULES](src/Caiwu.Delivery/MANAGED_MODULES.md) 和 `evidence/`；其中“尚未接线/未 Windows 实测”是对应历史快照，当前状态以精确源绑定的新记录为准。
