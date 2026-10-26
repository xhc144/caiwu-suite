# compat 合成证据

这里没有原数据库、安装器、反编译片段或真实账务样本。

- `SyntheticLedger.cs`：虚构 DataSet，含两个科目、已过账/草稿各一张、四行凭证、年初/账前余额和月度发生额；扩展字段覆盖辅助、外币、数量、合同、状态、人员/日期、NULL/空串/尾随空格及未知表 BLOB。原状态字符 `P/D` **仅为 fixture 自定规则**。
- `Fixtures/pr39-preflight.synthetic.json`：直接执行 PR39 head `11a8d776...` 的既有 `preflight.py` 生成，输入为运行时新建的四个虚构 DB/日志/配置/报表文件；不是伪造工具输出。生成时配置放入虚构口令以确认正文不出报告。此文件不带路径；`F004` 才是该次数据库，前三个为关联输入。该预检 fixture 与 DataSet 是两个独立测试输入，不声称内容对应或来自同一数据库。
- `CompatibilityTests.cs`：实际 DataSet/DbDataReader 捕获、所有原值保留、schema/owner 漂移、主从/键碰撞、精度/NULL/日期、显式 padding/状态/粒度、草稿排除、余额/发生额差异、取消、异常脱敏、禁止覆盖输入及 staging 清理；原缺驱动和外部自报来源不会被晋升为原账套验收。
- `SharedContractsProbe/`：独立可选 probe，使用 PR52 精确契约和合成宿主，检查同一账套 revision、报告文档形状、无新草稿/刷新/重试、冲突传播。**不执行 Core/SQLite，不证明真实事务/权限已接通。**

主测试只依赖新 compat 项目，基线 main 可以单独编译；可选桥依赖尚未进 main 的 ParityModules v1，必须另供/先集成检查点。没有把缺依赖做成静默跳过。

本轮 Linux/.NET 10.0.403 Release 合成测试：41 通过，0 失败，0 跳过；主测试编译 0 warning/0 error。SharedContractsProbe 在固定 `5bb60d2` 的真实契约副本上执行六个断言通过，输出 `core_sqlite_transaction=not_tested`。实际 SQL Anywhere 打开、原账套文件不变性、Windows、原版对照、完整 schema 和迁移/回滚均未测试。

早期 PR39 消费回归因错误地选择 `F001` 而被拒绝；修正为报告明确列出的 `F004` 后通过。该失败说明不能将“第一个选中文件”当作数据库。测试运行只在临时新建目录写合成文件/报告，不触及真实账套。
