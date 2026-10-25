# 私有交付门禁分项记录

2026-10-25，root 向最终 packaging/doc 集成任务明确回传独审结论并接受以下范围。本文件记录 root 的拥有者决定，不把它登记成本轮重新执行的测试，也不移除 `DELIVERY_PAUSED.md`。

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
