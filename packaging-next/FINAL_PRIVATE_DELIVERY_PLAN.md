# 最终私有交付：待放行的重建与核验方案

状态：**DELIVERY_PAUSED 保留，尚无最终分发包或 Release。** 本分支 `codex/final-private-packaging` / [草稿 PR34](https://github.com/xhc144/caiwu-suite/pull/34) 从 PR30 head `2707a72ffe1b73fed715517802e6ad62e48fe611` 接续，拣选文档 PR33 `4460fec7a9d3e07162a66bae2b2f69415d8ad73a`（本分支拣选提交 `e4a93295410ae7e6ef16f6c85e0aa107c983b828`）。不修改 book-project、main、权限、签名信任或更新策略。

**root 最新复核：**原五项 P1、dece298 的 F10 及实际恢复目标深回读已在明确范围内独审接受；[分项门禁记录](../docs/acceptance/final-private-review-gates.md) 保存来源及限制。余额深回读不是余额页可见性截图证明。生产变更检查点为 `75c84a6484eb79e1f9031b620539f39b976a1862`；root 要求先审此 diff，再明确批准最后门禁转换与最终构建。当前仍保留 marker。

## 三个身份分别冻结

1. **已有安装证据的源：**`dece298946d03ad88c5031eb02dab8f87c330046`。其 [安装 run40191539507](https://github.com/xhc144/caiwu-suite/actions/runs/40191539507)、[准备 run40191539456](https://github.com/xhc144/caiwu-suite/actions/runs/40191539456) 成功；完整范围和旧失败见 [PR30 交接](RELEASE_CANDIDATE_HANDOFF.md)。新文档/测试提交不追认成这些二进制的源。
2. **本轮待审生产路径：**完整 SHA 以 PR34 当前 head 和随后保存的 source-freeze 为准。`src` 生产基线保持 PR30 的树 `3854470d5c59e25d92c0e2f567a4ea8decbf8c27`；交付组合宿主增加显式 manifest 命令，不能把 `src` 未变当作整个 payload 未变。
3. **最终允许构建的源：**尚未指定。必须先集成根回传审核的两路安装业务 QA SHA、记录旧 P1 独审和新证据接受结果，由根明确放行，再形成包含暂停标记处理的最终不可变提交。最终版本由交付负责人明确指定；内部测试的 0.1.0.1/0.1.0.2 不是用户版号或可改名的最终包。

## 普通 builder 与内部构建的差异

| 路径 | 清单能力从哪里来 | 约束与用途 |
| --- | --- | --- |
| 旧普通 `build.py` | 组合宿主 `manifest`，默认 `managedDataContract=false` | 与已经使用 `launch-managed` 的快捷方式不配套；不能拿该默认值宣称受管产品已可安装升级 |
| `Build-InternalQa.ps1` | 独立测试控制器 `--internal-qa-manifest` 显式 true | 仅隔离 Windows CI，必须保留 hold；两个固定 QA 版本及 `INTERNAL-UNVALIDATED` 文件/报告，不获用户交付许可 |
| 本轮普通路径修订 | `--managed-data-contract --expected-commit <完整SHA>` 选择组合宿主 `manifest-managed` | 普通 `manifest` 仍默认 false。显式生产模式拒绝脏源码、锁刷新和 SHA 不符；原暂停门槛在工具/输出之前仍有效，NSIS 前再检查。此选项不是验收放行或认证绕过 |

生产路径保留 Desktop/host 分离 RID 锁图、四类原生 codec、真实子进程租约及回执校验；新清单不是手改 JSON。构建清单新增 `productionSourceTree`、实际 capability、payload 清单 hash 和逐文件清单，Windows 运行认证仍为 false，需独立运行报告佐证。中文安装说明纳入 payload 的 `delivery-notices`。

ZIP 改称 `*-win-x64-payload.zip`：内容用于核对 payload，不是已支持的免安装便携应用；受管启动仍需安装回执、激活指针和分离数据根。它也不实现跨数据根的便携备份恢复。

## 暂停期间可以核验的内容

- [准备 workflow](../.github/workflows/windows-candidate-validation.yml) 增加本分支，只进行 Python 门槛测试、PowerShell 解析与正负断言、clean locked 自包含发布、实际 helper 子进程/四 codec 组件检查和源清单；不会生成 installer 或 ZIP。源码未变且已有对应结果时不重复全量编译。
- `python tests/Caiwu.Delivery.Tests/test_build_gate.py` 检查实际 hold、显式 managed 选项不能绕过、缺失 reviewed SHA、dirty/lock-refresh 和错误 SHA 均在输出前拒绝。
- `HostIntegration` 实际子进程分别调用默认与显式 managed manifest，校验元数据和 payload 字节，再执行租约拒绝、codec 升级保护和卸载保留。Linux 结果必须标为组件结果，不能写成安装 Windows 通过。
- `python packaging-next/freeze-source.py --commit <完整SHA> --out <新JSON路径>` 从该不可变提交的 Git blob 生成全部跟踪文件的路径、mode、Git blob、长度/SHA256，以及整个树、`src` 和交付源码树。它不复制源码内容、不读取工作树未跟踪文件、不覆盖已有报告。报告生成后新增的证据提交不在旧清单覆盖范围内。

## 明确放行后的执行顺序

以下步骤**尚未运行**；根的明确放行及其拥有的 marker 处理是前置条件。

1. 核对最终完整 SHA 与批准记录、两路 QA 来源/结果和生产子树差异，在新的干净 Windows-2025 runner checkout 该 SHA。拒绝未跟踪修改和 hold 残留；使用固定官方 SDK10.0.402/runtime10.0.13、冻结 NuGet 图、hash-pinned NSIS3.13。生成 source-freeze 并独立抽查文件 hash。
2. 指定两个递增四段版本：初装测试版本和最终升级候选版本，均从同一批准源**重新构建**。首个构建运行 Delivery 组件回归；第二版本可用 `--skip-tests` 避免重复同套回归。命令核心为：

   ```powershell
   python packaging-next/build.py --version $initialVersion --managed-data-contract --expected-commit $approvedSha --makensis .tools/nsis/nsis-3.13/makensis.exe --out artifacts/delivery/first
   python packaging-next/build.py --version $upgradeVersion --managed-data-contract --expected-commit $approvedSha --makensis .tools/nsis/nsis-3.13/makensis.exe --out artifacts/delivery/next --skip-tests
   ```

   `$approvedSha` 必须来自根批准的完整 SHA，不能用未经复核的移动分支替代。检查两份 release-manifest、payload-manifest、SHA256SUMS 与实际文件，确认 source/version/capability 一致且无 INTERNAL marker。禁止改名或复用旧内部 EXE。必要时另行批准同版本重建比较；没有比较就不宣称字节可复现。
3. 构建独立 `InstalledDesktop` 控制器，然后调用：

   ```powershell
   ./packaging-next/Test-WindowsDelivery.ps1 -ProductionCandidate -ExpectedCommit $approvedSha -InitialVersion $initialVersion -UpgradeVersion $upgradeVersion -RequireManagedDesktop -Installer <新初装EXE> -UpgradeInstaller <新升级EXE> -ControllerExecutable <独立控制器EXE> -OutputDirectory <全新临时目录>
   ```

   production 模式要求 hold 已由 owner 处理、源码 clean 且完整 SHA 相符；内部模式仍要求 hold 和 INTERNAL marker。参数化仅替换旧的固定版本路径及分类检查，不删除原断言：正常登录/切人记账、plain F10 取消与接受、实际恢复目标双重深回读、两 OS 租约、忙态拒升级、空闲升级、升级后登录、更新禁用/未签名拒信任、原生卸载与全部观测数据 hash 保留、跨新根安全拒绝。生产运行报告保持 `approvedForUserDelivery=false`，由根检查最终实测后给出交付决定，不由测试脚本自批。
4. 在同一最终源组合上运行根已接受的 InstalledFinancialQA / InstalledBookFlowsQA workflow，并阅读每项 JSON、失败/跳过及实际 PNG；不要把打开窗口当成编辑/保存/复制执行通过。
5. 保存私有 Actions artifact：两个新 EXE、release/payload/source 清单及 SHA256SUMS、原始实际 PNG、业务与生命周期 JSON、中文安装说明。保持原始截图分辨率，不重绘产品画面；记录每张 PNG 的尺寸、路径及源/场景。现有控制器捕获不自动承诺所有窗口/DPI，按结果补齐。
6. 根验收后给出确切私有制品与运行 URL、最终用户版号和校验值；仍不合 main、不公开、不建 Release、不改仓库权限。未签名和无可信自动更新源按事实说明；不购买服务或生成凭据。

[`workflows/windows-delivery.yml`](workflows/windows-delivery.yml) 是上述步骤的待采纳模板，不在 `.github/workflows`，没有自动触发。采纳模板本身会产生新提交，须在新最终 SHA 上重新冻结并获得对应放行，不能复用之前 source-freeze。

## 保留的限制与等待项

- 原五项 P1 和 F10/实际恢复深回读已由 root 接受；仍等待其审查生产构建改动后，明确批准最后门禁转换与最终构建。安装余额页可见性及新截图待专项补证。
- 等待根回传两路 QA 的完整审核 SHA；本分支不写 `tests/InstalledFinancialQA`、`tests/InstalledBookFlowsQA` 及其 workflow。
- 跨数据根/跨机便携恢复无重映射实现，原 bundle+receipt 在新根被安全拒绝；不能改收据或放宽 SafePaths 伪造成功。
- 内部安装 fixture 深验已登记摘要；其它模块完整业务由专项安装 QA 证明。民非主账务仍只读/禁止新建，成本不自动记账，设计器有限，身份备份无主 UI；无原账套/旧身份自动迁移、生产原地 schema 迁移或断电恢复完成声明。
- 原始资源及完整派生资料上传继续暂停。本轮仅提交自写源码/文档变更与合成测试证据，不扩大已有内部安装器测试许可。
