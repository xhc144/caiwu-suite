# 成本领域首版验证（2026-10-25）

分支 `codex/costing`，基线 `97d696a3ee7adf100e24b4924438468bd34dd80c`。只新增 `src/Caiwu.Costing/**` 与 `tests/Caiwu.Costing.Tests/**`，没有改动Core/Contracts/SQLite/UI/solution；本模块没有这些项目依赖或任何存储/总账写入。独立DTO、API及覆盖边界见 `src/Caiwu.Costing/README.md`。

## 实际工具链和运行

复用此前核验的微软官方.NET LTS SDK10.0.402、runtime10.0.13，Debian13 x64。Costing库没有第三方包；测试用 Microsoft.NET.Test.Sdk **18.11.0**、xunit.v3.mtp-off **4.0.2**、xunit.runner.visualstudio **4.0.1**，均为精确版本，并提交NuGet lockfile及内容哈希。只使用 `https://api.nuget.org/v3/index.json`，未下载/运行原软件、未购买服务。

真实执行环境配置和命令（仓库根运行）：

```bash
export DOTNET_ROOT=/tmp/caiwu-dotnet-10
export DOTNET_CLI_HOME=/tmp/caiwu-dotnet-state/cli
export XDG_RUNTIME_DIR=/tmp/caiwu-dotnet-state/runtime
export XDG_DATA_HOME=/tmp/caiwu-dotnet-state/xdg
export NUGET_PACKAGES=/tmp/caiwu-dotnet-state/packages
export NUGET_HTTP_CACHE_PATH=/tmp/caiwu-dotnet-state/nuget-http
export NUGET_SCRATCH=/tmp/caiwu-dotnet-state/scratch
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
export DOTNET_CLI_TELEMETRY_OPTOUT=1

/tmp/caiwu-dotnet-10/dotnet restore tests/Caiwu.Costing.Tests/Caiwu.Costing.Tests.csproj \
  --locked-mode --source https://api.nuget.org/v3/index.json
/tmp/caiwu-dotnet-10/dotnet test tests/Caiwu.Costing.Tests/Caiwu.Costing.Tests.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true \
  --logger 'trx;LogFileName=costing-delivery.trx' --results-directory /tmp/caiwu-costing-results
```

两条命令均退出0，最终交付源码实际运行结果：

```text
Caiwu.Costing -> .../bin/Release/net10.0/Caiwu.Costing.dll
Caiwu.Costing.Tests -> .../bin/Release/net10.0/Caiwu.Costing.Tests.dll
Passed! - Failed: 0, Passed: 36, Skipped: 0, Total: 36
```

TRX `/tmp/caiwu-costing-results/costing-delivery.trx` 已解析复核。没有审批拒绝、宿主权限改动或剩余工具阻断。XDG/NuGet使用可写临时目录，HOME保持原样。

## 独立手算例与边界

商贸：期初商品10件100元；采购10件×12元＋可资本化采购费10＋不可抵扣税2＝入库132，另期间费用3。因此20件232，单价11.6；销售6件派发69.60，余14件162.40；再购6件×15＝90，余20件252.40。原销售退回2件按原价成本回23.20，库存22件275.60；全部售出成本275.60，库存数量和金额同时为0。采购建议借库存132、期间费3，贷应付135，未把期间费资本化。

生产：期初材料100单位1000元；领料A6单位60元、B4单位40元。A完工2件/人工工时1/机器工时3，B完工4件/人工工时3/机器工时1。人工池80按人工工时分配A20/B60，制造费用池40按机器工时分配A30/B10；A成本60+20+30＝110、单位55，B成本40+60+10＝110、单位27.5。各自完工入库后售出A1件成本55；余材料900、A55、B110，合计库存1065。领料、人工/制造费用归集、完工入库建议的在制角色净额0；材料没有重复生成分配建议。

尾差：人工0.01元、制造费用0.02元，各按A/B/C相同基数分配，人工A0.01/B0/C0，制造费用A0.01/B0.01/C0。即使输入产品顺序为C/B/A，仍按Ordinal成本对象顺序处理同余数。Int64上限金额92233720368547758.07按3:3:4分配，预期分别27670116110564327.42、27670116110564327.42、36893488147419103.23，精确到分守恒。

以上预期全部为独立常数，没有用被测实现生成预期；还验证了以下真实行为：

- 3单位0.02元逐件出库成本0.01、0.01、0；原3单位0.02销售分三次退回，成本0.01、0、0.01，累计不超原成本。
- 显示单价舍入为0时，仍使用完整库存比例派发1元；数量4位/单价6位/金额2位的有效精度、边界、溢出与负数明确检查。
- 零产量、非零在产品、非零费用配零基数拒绝；零费用配零基数返回0；零成本不生成空凭证。
- 负库存、未知存货、商贸/生产类型混用、无效领料、来源重复或跨批次重复使用拒绝。
- 供应商退货、领料退回、跨期业务、补插早日业务拒绝，不回滚重算历史。
- 同业务重试幂等、异内容/异政策拒绝、stale revision冲突、负revision拒绝；生产完工重复接收及跨账册接收拒绝。
- 指纹不受当前文化或无意义decimal尾零影响；结果列表只读，调用方修改原始数组不会改写库存或完工成本。
- 凭证建议带InventoryId/Origin/BusinessId及待审核状态，借贷平衡；没有实际审核、记账或调用账务服务。

## 后续集成与未验

这是无副作用的领域计算测试。尚未验证持久化事务CAS、重启恢复、跨进程竞争、真实总账科目映射/审核链、UI或实际行业数据。生产结果/费用池是可信数据输入，不能直接信任外部伪造DTO；持久化和适配器必须落地来源核验、唯一约束、防重、权限及原子提交，不能把函数中的revision比较当作数据库并发锁。

未实现多仓调拨/单位换算、多商品采购费自动分配、减值盘点、暂估价差、供应商退货/退料、WIP、复杂分步或联副产品、特殊行业、税务或财务报表。不存在完整ERP/生产合规验收结论。
