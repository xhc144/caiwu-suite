# 私有交付门禁分项记录

2026-10-25，root 向最终 packaging/doc 集成任务明确回传独审结论并接受以下范围。本文件记录 root 的拥有者决定，不把它登记成本轮重新执行的测试，当时未移除 `DELIVERY_PAUSED.md`；后续明确转换授权见本文末段。

## 已由 root 接受的独审范围

依据旧 Windows 实跑、最终精确不变 blob 及 managed/auth 接线复核，原暂停中的五项 P1 可以关闭：列布局、旧草稿覆盖更新、停用科目期初、歧义金额和锁错误处理。PR34 检查点 `75c84a6484eb79e1f9031b620539f39b976a1862` 的主产品 `src` 树仍为 `3854470d5c59e25d92c0e2f567a4ea8decbf8c27`，与 PR30 head `2707a72ffe1b73fed715517802e6ad62e48fe611` 相同；本轮没有再改这些生产窗口和业务实现。

root 同时接受 `dece298946d03ad88c5031eb02dab8f87c330046` 的原生 F10 取消/接受证据，以及**实际恢复物理目标**的独立快照、123.45 余额与已登记附件相等证据。来源为 [原生运行40191539507](https://github.com/xhc144/caiwu-suite/actions/runs/40191539507)、[恢复深回读](../../packaging-next/evidence/release-candidate/restored-readback-dece298.json)、[实际产品断言](../../packaging-next/evidence/release-candidate/installed-runtime-dece298.json) 和 [PR30 交接](../../packaging-next/RELEASE_CANDIDATE_HANDOFF.md)。

该安装 fixture 只有 `summaries` 附件。不能把四类 codec 的组件检查写成四类模块从已安装产品业务编辑到恢复的端到端均通过。旧所谓余额截图实际仍在凭证页，**不作为余额页截图或页面可见性证明**；余额页实际可见与新截图由 InstalledBookFlowsQA 补证。已持久化余额独立深回读的结论保留。

## 仍待 root 明确转换的门禁

- 普通生产 builder 的新显式 managed 路径，待 root 审查 PR34 检查点的 [diff](https://github.com/xhc144/caiwu-suite/compare/2707a72ffe1b73fed715517802e6ad62e48fe611...75c84a6484eb79e1f9031b620539f39b976a1862)。
- 两路安装业务 QA 的审核 SHA、逐项结果与剩余失败/未测，待 root 回传后集成；不越目录代写。
- **最终门禁转换、marker 处理及清洁最终生产构建尚未获准。** root 明确要求先审查生产改动，再单独批准。五个 P1 关闭不等于整套业务验收或向用户分发获准。
- 最终用户分发及 Release 仍不允许；不合 main、不公开、不改权限。未签名、无可信更新源及跨新根恢复不支持的限制持续有效。

最终构建/安装复验的准备方案见 [FINAL_PRIVATE_DELIVERY_PLAN.md](../../packaging-next/FINAL_PRIVATE_DELIVERY_PLAN.md)。最终批准须绑定届时的完整不可变组合 SHA，后续文档/证据提交不能追认成旧运行的二进制来源。

## 12:35 UTC：root 批准私有生产验证阶段

root 已审查并接受生产修订75c84a6，独立核验063a1b5的761文件freeze；明确授权转换旧 DELIVERY_PAUSED、采纳已审workflow、显式启用已审managed capability、冻结新完整SHA并用普通builder全新构建及原生生命周期复验。旧暂停文件据此转换为 [PRIVATE_VALIDATION_ONLY.md](PRIVATE_VALIDATION_ONLY.md)。本次移除旧标记有该独立明确授权，不是CI自批，也不表示全部业务通过。

已采纳 `.github/workflows/windows-private-delivery.yml`；初装/升级测试版本0.1.0.3/0.1.0.4。两次构建都运行组件回归，不使用 --skip-tests。保留新私有验证范围标记，新增release-manifest字段明确 `approvedForUserDelivery=false`；新source SHA与证据单独冻结。

用户分发、Release和原始派生上传仍禁止；两路QA可稍后由root给出审核SHA。生产验证失败可在既有授权内最小修复并保留失败证据。截止13:45 UTC前回报实际状态。

手动调用新workflow在65e435d返回GitHub HTTP404（workflow尚未在默认分支注册），没有创建运行或构建。这不是自动批准拒绝。为维持不合main边界，改用仅私有仓库、当前分支、workflow文件变化的push入口，绑定该事件的完整SHA；其余已审生产步骤不变，再冻结新SHA后运行。

## 摘要缺口修复与最终组合重验

root在PR36独审确认真实缺口后，明确授权本任务作为唯一生产写者补最小接线。单独生产修复SHA `42c718fa4770f3562b74b76f2bcb89f977bb52f6`：现成SummaryPicker、原始FeatureSessionBinding及SessionSummaryCatalog、原始catalog version校验，当前行回填、不自动保存、不刷新draft token，只读禁用和取消保留；新增Controls项目的交付自有RID锁图。交叉编译0警告/错误、locked restore通过。root正在独立复核。

PR35/36原目录与workflow先按精确blob集成为064a733。后续9f40fc4只调整验收：真实选择器取消/确认/当前行/显式保存/重开/只读；真实支持的管理员停用合成操作员，验证模态确认及原draft保存拒绝。原模态期间并发修改账套revision场景仍明确未执行（真实独占租约与模态设计下无支持入口），不冒称该场景通过；其安全替代范围仍由root判定。Financial测试仅参数化生产候选版本、修正动态产品路径元数据，保留seed分类边界，低成本断言增强未在此阶段扩大宣称。

40193886287已从3e83e0f普通builder成功构建0.1.0.3/0.1.0.4并实际安装；在收据原生文件对话框的控制器输入等待失败：回读只到fcae0，期望完整fcae01dcdd0040748452268b36d0ac11.json。原严格路径断言正确阻断，未确认错误路径。9f40fc4仅增加限时等待完整UIA值，原精确相等断言保留。该旧运行不计为最终通过。私有artifact12599127769，472138357bytes，SHA256 68bae9b531df581e7fda8951a5a8f0a0973ea85dd25b890905daff300084a2b1，已通过受支持工具下载并核验。

组合workflow明确固定9f40fc4为生产/既有生命周期控制器保护基线，保留全树diff保护并在新完整SHA上重新构建，随后对同一新生产安装器执行生命周期、财务及完整BookFlows，不删除失败/未运行场景。用户分发、Release仍不获准。

root进一步独审要求已实现两个局部修订：8c53093为摘要专用错误信息（已知catalog/auth/IO保留原因并说明摘要未回填、原输入保留；未知错误不再暗示保存不确定）；4689e29仅成功回填路径按Input优先级在Controls恢复焦点之后进入当前摘要格，其余FocusCell默认Normal不变。两次交叉编译均0警告/错误。BookFlows新增不重新设焦点的原生继续键入和Enter移动验证，并检查实际摘要专用授权原因。

376c004的运行40194966258在构建期间主动取消，以将上述真实生产修订纳入新的完整source SHA；不算通过或产品失败。下一候选仍重新运行两次全组件回归及三组实际安装验收，明确以4689e29为最新生产/既有控制器diff保护基线。原模态并发ledger revision场景明确以not-run放在unexecutedScenarios，并与实际运行的session revocation区分，等待root范围判定。

## 55028f8实际结果与可恢复的控制器修复

run40195378910：普通builder两版本构建、实际原生生命周期全部步骤、实际安装金融四业务及5附件/4codec恢复均通过。BookFlows已有11个声明case通过，含摘要真实取消/回填/保存重开、无重新设焦点的继续输入与Enter、只读拒绝、复制/实际恢复/可见余额；session撤销case在调用撤销前失败，独立readback未运行。首错不是产品：测试用大小写敏感LoginName查找fixture-reviewer，而LocalOperatorService规范化为大写；后续App退出与readback.json缺失是清理未完整的后续症状。修复只改成创建账号时普通API返回的稳定Identity.Id，并记录精确撤销ID/启停状态，不改原失败/缺失readback门槛或生产代码。

旧artifact12600260852（490426961bytes）SHA256 4aa6f9524bdb60a1c3ec29d2497f5389ffab5b75c85851feafe7812e995b2cb9，受支持工具下载并核验；原始失败报告和截图保留。本轮新SHA再跑组合，补入每个版本的原始delivery-tests.json证据上传；原生并发修改ledger revision仍明确未执行、由root判定已实际执行会话撤销的替代范围。
