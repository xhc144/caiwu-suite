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
