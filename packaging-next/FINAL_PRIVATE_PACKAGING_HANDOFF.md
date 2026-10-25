# 最终 packaging/doc 集成交接

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

本地 working-tree 检查另有官方 SDK10.0.402 下载 SHA512 与固定 metadata 相等、组合宿主零警告/错误构建、Linux helper 子进程9项、Python门槛7项及 Markdown本地链接/UTF-8/YAML/diff检查通过。本地结果不冒称 Windows 安装，源码绑定的 Windows 结果以上述 immutable checkpoint 为准。没有新测试失败，没有自动批准拒绝或不确定远端写入。

## root 分项接受与剩余门禁

root 已明确接受原五项 P1 和 dece298 的 F10/实际恢复目标深回读，来源、范围和 owner 决定见 [分项门禁记录](../docs/acceptance/final-private-review-gates.md)。安装 fixture 仅含 summaries；旧所谓余额截图仍是凭证页，不能称余额页图。BookFlows QA 正补可见性/新截图。

**等待：**root 审查上述生产路径 diff 后，明确批准最后门禁转换与最终构建；并回传 InstalledFinancialQA / InstalledBookFlowsQA 的审核 SHA。本轮不改这两目录及其 workflow。主产品 `src` 树 **`3854470d5c59e25d92c0e2f567a4ea8decbf8c27`** 与 PR30 相同；Delivery组合源码树为 **`454dba0d36468fcb2b139678f202d3e14b9b6e0e`**。pause marker 和 disabled update policy 未改。

**未运行/未执行：**marker 删除、普通生产 builder 的最终 installer/ZIP 构建、生产候选实际安装/升级/卸载、新的安装业务 QA 集成、最终高清截图交付、向用户分发、Release、main 合并、公开/权限变更、签名信任/更新源配置。原始资源及完整派生资料上传继续暂停。此等待是 root 尚未给出最后放行，不是工具拒绝；没有重试被拒动作。

下一步由 root 审查固定检查点。明确放行后按 [方案](FINAL_PRIVATE_DELIVERY_PLAN.md) 在新的最终完整 SHA 上冻结、clean 重建及实际安装复验；不能改名旧内部包，不能复用旧 source/hash 或把五 P1 关闭解释为全部业务验收完成。
