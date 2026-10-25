# 最终私有候选交接：9549ae0

**root已最终独审接受9549ae0为有限功能的合成账套私人测试版本，可由root交付；不是原任务全部完成或用户接受缩减目标。** 普通builder的新候选源9549ae0671e04d9c7fa565cfb34d614fa3effc0b，在[run40196386649](https://github.com/xhc144/caiwu-suite/actions/runs/40196386649)同时通过原生生命周期、金融4业务/5附件4codec恢复、修订后BookFlows声明13case及独立已安装helper读回/卸载保留。原模态并发ledger revision未实跑，仍以not-run显式保留，root明确接受实际会话撤销证据，同时原revision场景不称等价或实跑；该边界不阻断合成私人测试，仍不构成所有场景/正式账务验收。

[安装器专用小包artifact12600694219](https://github.com/xhc144/caiwu-suite/actions/runs/40198401255/artifacts/12600694219)已成功：132306768bytes，ZIP SHA256 dc54d8c006c542e328e9e2faa1eb7e74e3449f74c303a7356e161a9b4afbd1cb。一次性handoff run40198401255/b46e940仅核原artifact/EXE并复制，不构建/执行/修改；安装器来源仍9549ae0。聊天大附件未送达是产品大小限制，原文件不拆分，本任务没有重试上传。

[最终候选清单与中文说明/截图](PRIVATE_CANDIDATE_MANIFEST.zh-CN.md)是交接入口。可供root决定交付的是有限功能私人测试版本，不是三套原软件完全复刻或财务合规认证。

- 候选0.1.0.4：132284835bytes，SHA256 `9248d0363c639caeada84810959d0a8a885d8c1c45cdc7677476b0a4476bcf0b`。初装对照0.1.0.3：132286557bytes，SHA256 `9889eee915f2cd398f9ed92e473ebca08cd8764e017b6b5ee17e9466cc8fdeb1`。数值来自实际普通builder原始release-manifest，root已独立实字节核对；没有改名内部包。
- [artifact12599758441](https://github.com/xhc144/caiwu-suite/actions/runs/40196386649/artifacts/12599758441)：490768016bytes，GitHub SHA256 `b626617a5e8a4c627652540d4ea8651159baecb394a1e658e5d7ba2bdcd59d5b`。为避免与root重复整包传输，本checkout只取30,512,759bytes Range并验证成员CRC。root已独立完成整包/二进制核验；本checkout不冒称重哈希整包。
- Windows source-freeze866条与本地Git对象清单全部相等；该原始JSON SHA256 `67c7e728da4365dbef54a68083038661a2690319ba517716b9a6a4af3c000e58`。src树714a5a79ecb11c0c08ced48841d4e9aa54785212，Delivery组合树454dba0d36468fcb2b139678f202d3e14b9b6e0e。后续报告文档提交不是安装器来源。
- 两版组件各162 passed/0 failed/4平台skip（共166，原始JSON保留），未跳过测试。金融/Book证据清单逐成员hash和长度核对、5附件hash/version对照、实际可信收据对原始backup manifest的SHA均再次检查。两版payload清单摘要及448项文件记录与release清单相符；实际随包中文说明bytes也与payload条目hash相符。
- 48张PNG均原生1920×1080；7张关键图逐张目视并原字节保存在evidence/final-private/accepted-9549ae0/screenshots。真实余额页123.45、摘要原生继续输入/Enter、专用撤销提示均可见；金融合成110/10、Designer1002行10及成本254可见。成本分配最右列裁切，不声称目视完整21/63。

**失败与恢复均保留：**3e83e0f普通构建成功，旧控制器过早读到原生收据路径前缀而拒绝确认；9f40fc4保留严格路径断言并等待完整输入。55028f8生命周期/金融/摘要原生链通过，新增撤销测试用小写登录名查规范化大写身份失败，后续readback缺失；9549ae0改用服务返回稳定ID，完整撤销、正常退出、readback和卸载已实跑通过。不将旧失败或取消重标成功。

**剩余限制：**root已完成精确字节及报告/图独审，限私人合成测试；原模态并发ledger revision未跑。未签名，无可信自动更新feed，跨新根portable恢复未支持；民非只读/不新建、成本不自动记账、Designer有限、无原账套/旧身份自动迁移、生产原地schema迁移或断电恢复完成声明。合成分类seed及精确金融行列断言边界详见矩阵。本任务没有用户上传/Release/main合并/公开/权限或签名设置变更；原资源及完整派生上传仍暂停。没有新增产品安全blocker或自动审批拒绝；工具日志保存曾遇单参长度限制，分块落地恢复。

当前checkout /workspace/caiwu-final，分支codex/final-private-packaging，[草稿PR34](https://github.com/xhc144/caiwu-suite/pull/34)。book-project未改。使用真实项目交接记录，没有Handoff MCP。停止功能扩展，只保留源绑定成果与root最终决定。

---

以下为上一阶段历史记录，保留原范围和失败，不替代上述新源结果。

# 最终 packaging/doc 集成交接

> **12:35 UTC阶段更新：**root已明确批准私有生产构建及实际安装生命周期验证。旧 DELIVERY_PAUSED 已转换为 `docs/acceptance/PRIVATE_VALIDATION_ONLY.md`，新workflow已采纳，新的完整SHA及结果单独冻结。用户分发和Release仍未批准；两路QA的审核SHA仍待root回传。以下原有暂停/待采纳表述是上一阶段记录，以本更新及分项门禁记录的最新授权为准。


2026-10-25。本轮 checkout `/workspace/caiwu-final`，分支 `codex/final-private-packaging` / [草稿 PR34](https://github.com/xhc144/caiwu-suite/pull/34)。没有改 book-project。workspace `.agents` 为空，仓库无适用 `AGENTS.md`/`.agents/skills`；使用项目现有交接和真实 Git/CI 证据，不假称 Handoff MCP。

## 可审查结果

生产路径检查点 **`75c84a6484eb79e1f9031b620539f39b976a1862`**，基线 **`2707a72ffe1b73fed715517802e6ad62e48fe611`**；[固定 diff](https://github.com/xhc144/caiwu-suite/compare/2707a72ffe1b73fed715517802e6ad62e48fe611...75c84a6484eb79e1f9031b620539f39b976a1862)。后续提交只保存 root 分项接受决定、报告与交接文档，不追认成该运行源。

- `build.py` / 组合宿主：显式 `--managed-data-contract --expected-commit <完整SHA>` 选用 `manifest-managed`。默认 manifest 仍 false，managed 模式拒绝 dirty/lock-refresh/错误 SHA；原 hold 继续在工具/输出前阻断并在 NSIS 前重检。新增真实 capability、source tree、payload 文件及清单 hash；中文说明随 payload 保存。移除 skip-tests 分支的重复 helper build。
- `Test-WindowsDelivery.ps1`：增加仅放行后使用的 `-ProductionCandidate`、完整 SHA 和递增版本参数，保留原生命周期断言。内部模式仍需 hold 和 INTERNAL marker；生产模式要求 hold 已由 owner 处理、clean exact SHA，并拒绝内部 marker。只验证了语法与真实 hold 阻断，**尚未执行生产 native lifecycle**。
- PR33 文档 `4460fec7a9d3e07162a66bae2b2f69415d8ad73a` 已拣选为 `e4a93295410ae7e6ef16f6c85e0aa107c983b828`，并按 dece298 的精确安装范围更新。明确同根原路径恢复、跨新根便携导入不支持、身份备份独立、未签名/更新禁用及模块覆盖限制。
- `freeze-source.py` 与 [重建方案](FINAL_PRIVATE_DELIVERY_PLAN.md) 已准备。[生产 workflow 模板](workflows/windows-delivery.yml) 仍位于非活动目录，没有触发最终构建；ZIP 改称 payload 核对档，不承诺免安装运行。

## 本轮真实验证

**成功：**精确检查点的 [Windows 准备 run40192913945](https://github.com/xhc144/caiwu-suite/actions/runs/40192913945)，job121167560484。通过 Python 门槛7项、PowerShell 解析/正负断言8项、clean locked self-contained 发布、实际 self-contained helper 子进程9项与四原生 codec/身份组件集成，以及源码不变/hold 保留/无安装器 ZIP 断言。它没有安装产品，不是最终用户包验收。

[私有证据 artifact12599335084](https://github.com/xhc144/caiwu-suite/actions/runs/40192913945/artifacts/12599335084) 为 **82147 bytes**、SHA256 **`dd884903c3bfcf2ffbd671decf2359805f0a1f817365492678e6f90177aaf4a4`**。通过受支持 GitHub artifact 工具下载并与 GitHub digest 核对；内容仅四个 JSON，没有安装器或产品分发包。原始报告按字节保存在 [evidence/final-private](evidence/final-private/verification.json)，目录 `.gitattributes` 保留下载字节。

- `source-freeze-75c84a6.json`：761 个跟踪文件；hash **`d8fc730c18460b8b36baccbbfca174ba2089de5e87a571ac04d20a9133c2e009`**。Windows 清单与本地从同一不可变 Git 对象生成的全部条目相等，另对4个关键文件独立逐字节 hash 抽查。清单不包含其生成后的本次证据提交。
- `preparation-75c84a6.json`：440 个自包含 payload 文件，`installerGenerated=false`、`archiveGenerated=false`、`installedRuntimeValidated=false`。
- `host-integration-75c84a6.json`：默认 false、显式 managed、源/版本/原始 payload 字节及实际 verify 子进程均验；真实租约拒绝、带 codec 的 helper 升级备份/数据保留和卸载保留通过。
- `module-integration-75c84a6.json`：四 codec 与身份隔离组件通过，**不是四模块已安装业务端到端认证**。

本地 working-tree 检查另有官方 SDK10.0.402 下载 SHA512 与固定 metadata 相等、组合宿主零警告/错误构建、Linux helper 子进程9项、Python门槛7项及 Markdown本地链接/UTF-8/YAML/diff检查通过。本地结果不冒称 Windows 安装，源码绑定的 Windows 结果以上述 immutable checkpoint 为准。初次原始 CRLF 报告的 diff 检查把 CR 误作行尾空白；已在该证据目录显式保留下载字节并识别 CRLF，重新检查通过。没有产品测试失败，没有自动批准拒绝或不确定远端写入。

## root 分项接受与剩余门禁

root 已明确接受原五项 P1 和 dece298 的 F10/实际恢复目标深回读，来源、范围和 owner 决定见 [分项门禁记录](../docs/acceptance/final-private-review-gates.md)。安装 fixture 仅含 summaries；旧所谓余额截图仍是凭证页，不能称余额页图。BookFlows QA 正补可见性/新截图。

**等待：**root 审查上述生产路径 diff 后，明确批准最后门禁转换与最终构建；并回传 InstalledFinancialQA / InstalledBookFlowsQA 的审核 SHA。本轮不改这两目录及其 workflow。主产品 `src` 树 **`3854470d5c59e25d92c0e2f567a4ea8decbf8c27`** 与 PR30 相同；Delivery组合源码树为 **`454dba0d36468fcb2b139678f202d3e14b9b6e0e`**。pause marker 和 disabled update policy 未改。

**未运行/未执行：**marker 删除、普通生产 builder 的最终 installer/ZIP 构建、生产候选实际安装/升级/卸载、新的安装业务 QA 集成、最终高清截图交付、向用户分发、Release、main 合并、公开/权限变更、签名信任/更新源配置。原始资源及完整派生资料上传继续暂停。此等待是 root 尚未给出最后放行，不是工具拒绝；没有重试被拒动作。

下一步由 root 审查固定检查点。明确放行后按 [方案](FINAL_PRIVATE_DELIVERY_PLAN.md) 在新的最终完整 SHA 上冻结、clean 重建及实际安装复验；不能改名旧内部包，不能复用旧 source/hash 或把五 P1 关闭解释为全部业务验收完成。
