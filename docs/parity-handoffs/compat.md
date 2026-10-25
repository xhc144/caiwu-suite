# compat 原账套兼容切片交接

更新：2026-10-25 UTC。独立 checkout `/workspace/caiwu-compat`；独占分支 `codex/parity-compat-20261026`；基线/当前实现前 SHA `3b0c59b02d8941c32ac176309555c03c94bb4213`。状态：in-progress，尚未验证，不代表原账套可读。

## 所有权与原入口

仅新增 `src/Caiwu.LegacyCompatibility/**`、`tests/Caiwu.LegacyCompatibility.Tests/**` 与本文。禁止改共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow/解决方案/props/工作流。无本 checkout 适用 AGENTS.md。已读既有 `.ai-handoff/STATE.md`，其中 0.1.0.4 验收不能代表本次原版保真目标。

关联原窗口：`w_tzjl_get` / `w_tzjl_get_all`（引入备份）、`w_hf`（恢复）、`w_xt_kmwh`（科目）、`w_pz_pzedit` / `w_pz_pzxsb`（凭证）、`w_xt_ye` / `w_zw_ye_1`（期初/余额）。此切片不新增 UI，不猜坐标，不接入原“自动升级”或“恢复”按钮。

## 首切片 API（设计中，最终以源码为准）

- `ILegacyReadOnlyExtractor`：读取关系快照；不提供写入/升级/密码/启动引擎 API。实际 SQL Anywhere 驱动不可用，明确返回缺驱动；用合成 DataSet 和 DbDataReader 捕获边界验证。
- 保留原表/列声明、NULL/空串/空格、所有字段、原行序与二进制原值；核心投影不替代原数据。
- 核心 `kmbm` / `pz` / `pzdj` / `nc` / `hz` 映射与明确口径的关系/借贷/期初/月度发生额对账，原状态码不自行解释。数值不转整数分。
- 复用 PR #39 `tools/original-compat-preflight/preflight.py` 输出，通过报告适配器消费，绝不重造文件扫描/哈希逻辑。
- 预演结果显式分 synthetic / 原账套 not_assessed；失败不提供可应用候选，不写源文件；报告仅在新目标发布。

## 共享核心集成精确建议

集成者（公共核心线程 `01a1757c-3fa8-76aa-a1d6-9e3aa4858034`）应扩展目标存储以完整保留：科目辅助/外币/数量/现金流量/停用标志和默认维度；凭证年/月/类型/号/行号及状态原值，制单/审核/记账人和日期、附单、外币/汇率/数量/单价、项目/客供/部门/人员/现金流量/合同/到期日；年初与帐前发生额、币种/辅助粒度；原声明类型、未识别列/表、BLOB 原样保存层和来源/版本指纹。不得把兼容候选下投为当前简化 SQLite DTO，也不得把科目编码加唯一键前未经碰撞检查裁剪空格。原 `pzdj_bz`、`pzdj_jzr`、`hz.xmlb/xmbm`、`nc.fbs` 等语义需要验证 profile，不从非空或字符猜过账状态。

需要未来统一接口：带原值容器的 lossless snapshot，受审核的 schema/status/aggregation profile，copy-only read session attestation，隔离目标事务与提交前验证钩子。此切片不实施目标写入；不得向此报告 API 添加直接覆盖旧库的默认动作。

## 证据与未实现

直接复用 main 的 original-analysis README、gap-analysis、tables/data/products/json 和 PR #38/#39/#40 既有成果；不重复解析安装包、不运行原程序、不读真实账套。PR38 暂不切底层的旧前提已由用户授权替换。PR39 head `11a8d77689ca9a6408fe493e7c1fcc10519db4a6`；PR40 head `8de73d52f7031d24b684e56b951cf20766acae2c`。

待补：具体驱动/版本/授权身份、账套代码→物理库/owner 映射、全部 schema 变体和状态码、全部模块/报表/附件语义、真实副本只读验证及停止后哈希、Windows 原版对照、目标持久化与可回滚迁移。所有原未实现项仍列在原 gap-analysis，不删除、不以本切片覆盖其验收。

测试：尚未运行；计划独立项目编译与合成关系测试。无权限拒绝；无不确定数据库动作。
