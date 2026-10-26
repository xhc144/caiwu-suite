# 核心账簿取数接口

- `ledger.balances` 返回整数分余额、本期发生额和本年累计。余额从最近一个已存期初锚点起算；累计从查询末期所在年年初起算，首启用年从账套 `startPeriod` 起算。实际覆盖的期间必须全部已建立。
- 缺失累计期间报 `LEDGER_YTD_PERIOD_MISSING`；累计期间完整但余额承接历史缺期间报 `LEDGER_BALANCE_PERIOD_MISSING`。未建未来年度或中间年度不再默认为零，不据此推算 carry。这是旧默认查询行为的收紧。
- 已建历史期间及已存期初锚点仍可读取；锚点之前未参与本次计算的期间不额外要求补建。早于账套启用期间的查询继续拒绝。
- 报表 `BALANCE` 原七个字符串参数的语法和序列化保持不变；可选第八参数承载期间等选项。参数兼容不等于查询行为完全兼容，七参数也适用期间完整性检查。
- `excludeClosingKinds: ['pnl']` 仅排除损益结转发生额；`excludeClosing: true` 排除全部标记的结转发生额。历史期初不重写。账前累计缺乏结转来源时拒绝筛除；原始非零累计即使在汇总时正负抵销，也保留未知来源标记。

未完成：科目语义来源、needsReview 和双向元数据持久化；民非分类来源及报表同事务预检钩子。未知分类不按名称猜测，也不按零处理。


## 库存成本事务接口

- 只读快照：`const snapshot = await svc.inventory.snapshot(period)`；返回 `InventorySnapshot`，包含账套、actor、module、库存/期初版本和 fingerprint。输入及结果类型从 `@caiwu/core` 导出。复用库存模块算法，core 不读写库存表。
- 原子发布：`await svc.tx(t => t.inventory.with(async inv => { /* 先写调用方批次，再 await inv.commitCosting(input)，以及 t.vouchers / inv.lockVoucherSource */ }))`。任何错误让同一事务内批次、库存、凭证、日志一起回滚。
- `inv` 只提供 `snapshot`、`commitCosting`、`cancelCosting`、`lockVoucherSource`、`releaseVoucherSource`。入参沿用 `CostingCommitInput`、`CostingCancelInput`、`VoucherSourceInput`，金额为整数分、数量为十进制字符串。必须 await 每个操作和整个 `with`；事务会排空遗漏等待的 `with` 并失败回滚，捕获 `with` 异常也不能提交部分写入。
- inventory 模块通过 `defineServerModule(..., { providers: { inventory: svc => ... } })` 注册无状态工厂。每个 runtime 独立登记，每次调用传入原始 svc；不缓存绑定账套/操作员的实例。未注册报 `INVENTORY_PROVIDER_MISSING`。
- 请求、事务和 with 回调任一结束即撤销对应能力；其它请求、事务、模块不能借用，事务内不得使用外层 svc。库存工厂仍负责权限、账套/actor/module/fingerprint 和正式来源状态检查。

后续切片：民非报表同事务预检；Windows FINAL_STDIO。
