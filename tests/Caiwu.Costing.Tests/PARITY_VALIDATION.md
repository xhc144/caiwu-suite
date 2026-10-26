# inventory 保真切片验证（2026-10-26 UTC）

基线：main `3b0c59b02d8941c32ac176309555c03c94bb4213`。当前分支 `codex/parity-inventory-20261026`。
SDK：10.0.402；运行时：10.0.13；Linux Debian 13 x64。
测试仅使用本目录代码构造的合成商品、仓库、单据和账户。未运行原程序、安装器或 SQL Anywhere 引擎，未读取真实账套。

## 本轮实际验证

- 独立领域测试：37 通过，0 失败，0 跳过。核算、单据流程、原始字段保留、静态 PBU 坐标均有行为断言。
- 独立 adapter 测试：28 通过，0 失败，0 跳过。使用合成 `IParityLedgerService`，核对请求和错误行为；不是生产 Core/SQLite 的事务集成测试。
- `Caiwu.Costing.Wpf` Windows target 交叉编译通过，0 warning、0 error。未在 Windows 创建窗口、截图或实测键盘/DPI/焦点。
- Contracts 对照使用 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的独立只读源树，逐文件 Git blob 哈希核对一致；本分支未修改共享 Contracts。
- 证据摘要见 [evidence/parity-validation.json](evidence/parity-validation.json)。TRX 为本地测试输出，仅摘要入库，未提交环境私密信息。

## 评审返修与实跑（既有切片，未新增模块）

被审查版本：`4756315aff67e8a565325d587249ccda536e1167`；修复实现：`1dcc08c7186ac61a5a826e83453c080973898990`。
先加入回归并在旧实现上运行，重复原行的 6 条断言失败（2 行变 1 行），期间边界 9 条断言失败（写入未被拒绝），已使用商品改库存科目的 4 条断言失败；未使用商品改科目仍通过。完成修复后全量运行上述两组测试与 Wpf 构建，全部通过。

- 原始行保存改为按出现次数匹配：既存行不去重、不改行序，候选袋只补超过既存次数的行；重复存盘不会增加次数。被删除明细的原始行移到文档归档袋一次，其余明细仍留在原位置。回归覆盖产品、期初、盘点、单头、单据明细、未知列、NULL、二进制和尾空格，及候选行数 0/1/2/3。
- adapter 按同一观测快照校验 `FiscalYear/StartMonth/ClosedThroughMonth`。总账 2026 年 10 月启用时不能初始化/载入 2025/10 或 2026/09 状态；10 月已结时可只读载入 10 月，但 `SaveOpening→TryCommit`、`CancelCalculation→TryCommit`（无 claim）及凭证提交均在调用 service 前拒绝。不能借保存把单月文档替换成其他期间。有效未结月仍允许建立状态。
- 产品已有期初、单据或盘点记录时，`SaveProduct` 和 adapter 保存边界都拒绝直接改 `InventoryAccount`。回归先认领/接收入库 10 件／100 元（借 1405），拒绝改到 1406 后继续销售、核算 10 件，确认出库仍贷 1405／100，库存归零且原科目对消。未使用商品仍可修正科目。没有新增重分类迁移功能。

上述仍为 Linux 合成领域/契约服务验证；生产 Core/SQLite、原账套与 Windows 实机边界不变。

## 独立手算锚点

1. 期初 10 件／100 元，10 日销售 5 件，20 日另入 10 件／300 元：月末平均成本 `(100+300)/(10+10)=20`，销售成本 100，期末 15 件／300。移动加权会给早先销售 50，测试明确检出两条路线的差别。
2. 仓库 10 件／100 元、车间 10 件／500 元，各出 2 件：成本分别 20、100；余款分别 80、400，不能混算。
3. 3 件共 0.01 元，依次出 1、1、1：累计舍入分配为 0、0.01、0，末次全出后余款为零。另一锚点 3 件／1 元出 2 件，成本 0.67、余款 0.33。
4. 10 件／100 元出 2 件后，盘实 6 件：差异 -2 件／-20，结存 6 件／60；盘实 9 件：差异 +1／+10，结存 9／90。每个总额都断言 `期初+入库-出库+盘点差异=期末`。
5. 入库确认不含税 100、税 13、价税 113：存货借 100、进项借 13、付款贷 113；销售不含税 60、税 7.8：收款借 67.8、收入贷 60、销项贷 7.8。测试不根据税率推断抵扣资格或改写已确认金额。

## 可重复命令

默认仓库的 `global.json` 指定 .NET 10.0.402。常规有写入权限的开发环境：

```sh
dotnet test tests/Caiwu.Costing.Tests/Caiwu.Costing.Tests.csproj -p:RestoreLockedMode=true
dotnet build src/Caiwu.Costing/Wpf/Caiwu.Costing.Wpf.csproj -p:RestoreLockedMode=true
```

adapter 需要公共接口检查点。集成者已纳入接口时直接运行：

```sh
dotnet test tests/Caiwu.Costing.Tests/AdapterTests/Caiwu.Costing.ParityAdapter.Tests.csproj -p:RestoreLockedMode=true
```

在本分支固定基线上，先把检查点的 Contracts 和 props 读到独立目录，给 adapter 的项目引用传入路径；不把接口文件复制回本 checkout：

```sh
mkdir -p /tmp/caiwu-contract-checkpoint
git archive 5bb60d24b9c60c9eecfcc5adc37bced4688adf85 src/Caiwu.Contracts Directory.Build.props | tar -x -C /tmp/caiwu-contract-checkpoint
dotnet test tests/Caiwu.Costing.Tests/AdapterTests/Caiwu.Costing.ParityAdapter.Tests.csproj -p:ParityContractsProject=/tmp/caiwu-contract-checkpoint/src/Caiwu.Contracts/Caiwu.Contracts.csproj -p:RestoreLockedMode=true
```

本环境 SDK 安装于 `/workspace/caiwu-tools/dotnet`，CLI/NuGet 缓存独立配置在该工具目录；最初 SDK mutex 因只读用户目录失败，经工具授权的编译执行环境运行成功。未更改 HOME、默认 book-project 或仓库公共配置。
曾误把 `--locked-mode` 传给 `dotnet test`，命令拒绝该开关；改用 `-p:RestoreLockedMode=true` 后通过。
首个外部 Contracts 副本漏掉根 props 导致缺隐式 using；改为精确归档 Contracts+props 并核对哈希后通过。新增“首次初始化”用例最初暴露合成服务只支持已有集合的问题；修正 fixture 的集合追加行为后重跑通过，不把此失败冒称生产服务缺陷。

## 不能从以上结论推出的事项

- 静态坐标测试直接读取已有 `windows.json`，只证明三个对话框的已知矩形/文案一致；不证明原字体、运行时可见性、PBU 像素换算或 Windows 实机通过。
- 合成服务证明 adapter 使用同一个观测 revision，并一次发送状态变更/来源键/凭证，不证明公共 Core/SQLite 已经实现或通过原子事务验收。
- 权威状态是账套内 `LedgerModuleDocument`；没有外部 JSON 文件与总账“原子一致”的宣称。
- 原格式读取、未知变体解释、辅助/外币/数量总账分录、跨期结转、单据/产品完整 UI、MDI、权限、报表与打印都仍需后续切片。完整原版验收清单保留在 handoff。
