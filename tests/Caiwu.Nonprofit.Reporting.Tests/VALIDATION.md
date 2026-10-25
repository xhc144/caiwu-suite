# 民非2026报表：验证与交接

2026-10-25。独立工作目录 `/workspace/caiwu/nonprofit-statements`，分支 `codex/nonprofit-statements`，起点 `a49d426d8513600dec0f624f56a35c9ad66e71d4`（当时最新 `codex/windows-mvp`）。只新增分配的报表与测试目录，根solution、Desktop、Contracts、Core、SQLite及预挂载书库未改。未获取、执行或重新分析原安装包，未新增其派生catalog。

## 有用结果

- `NonprofitBalanceSheet.Calculate`：2026表样47个基础金额项目，显式年初/期末、受托代理、抵减准备与到期分析、负数及未结转阻断。
- `NonprofitActivityStatement.Calculate`：基础21行及按输入增加的组成行，收入费用双类别、本期/YTD、方向性双向转类、前期调整、负损益及年度比较标记。
- `NonprofitStatementReconciliation.Compare`：同来源版本两表的年初→期末净资产差额对照YTD两类变动。
- `NonprofitStatementExporter`：计算预览安全CSV与HTML，缺失原因与待审标记保留；正式报表目的拒绝。
- `LedgerSnapshotGapAnalyzer`及 `INonprofitStatementDataSource`：不猜测缺失持久化维度。主集成所需接口和来源责任见模块README。

## 独立手算预期

所有数据均为合成，预期值是逐项手算常数，未用被测计算器生成预期。

| 样例 | 独立预期 |
|---|---|
| A活动表，6月 | 收入非限定1375、限定2500；费用340、675；解除+120/−120，增加限制−40/+40，前期调整−10/+15；净变动1105、1760，合计2865 |
| A活动表，1–6月 | 前期额外收入200/400、费用100/150，故累计净变动1205、2010，合计3215；与6月数明确不同 |
| A资产负债表 | 流动资产14200，长期投资6450，固定资产3560，无形净值880，非流动11220，受托代理700；资产26120；流动负债3250，长期4650，代理700，负债8600；净资产17520 |
| A跨表 | 年初非限定6000、限定4000；加YTD1205/2010，期末7205/6010，资产总计13215；把6月数当YTD会勾稽失败 |
| B活动表，2月 | 0.1+0.2=0.30；非限定收入−99.70，费用25.25；限定收入500，费用25.50；含双向转类和前期调整后净变动−99.95/452.50，合计352.55 |
| B活动表，1–2月 | 1月另有限定捐赠50、非限定管理费2，累计净变动−101.95/502.50，合计400.55 |
| B资产负债表 | 银行100、固定清理−20、文物1、无形净值250，资产331；职工/税费合计−15，净资产−154+500=346；两边331 |

另有受限捐赠1000、限定成本300、损益结转前后、全额解除700测试：普通收入/费用保持1000/300，使用时不自动释放；解除后非限定变动700、限定0；未结转资产负债表净资产留缺失。

## 实际执行

SDK为官方.NET10.0.402；生产依赖Contracts，无新增应用技术栈。测试依赖沿用现有项目锁定版本：Microsoft.NET.Test.Sdk18.11.0、xunit.v3.mtp-off4.0.2、runner4.0.1，锁文件含传递依赖hash。

```sh
CAIWU_DOTNET_ROOT=/workspace/caiwu/tools/dotnet bash tools/dotnet-local.sh restore \
  tests/Caiwu.Nonprofit.Reporting.Tests/Caiwu.Nonprofit.Reporting.Tests.csproj --locked-mode
CAIWU_DOTNET_ROOT=/workspace/caiwu/tools/dotnet bash tools/dotnet-local.sh test \
  tests/Caiwu.Nonprofit.Reporting.Tests/Caiwu.Nonprofit.Reporting.Tests.csproj \
  --no-restore -c Release -p:TreatWarningsAsErrors=true \
  --logger 'trx;LogFileName=nonprofit-statements.trx'
```

已运行35项单元/行为测试：通过35、失败0、跳过0；生产构建0警告0错误。测试覆盖两个手算样例、组成子集不重复、慈善信托/募捐成本、非零限定所得税专门复核、内部预算/未知类别拒绝、缺项目/缺窗口/缺覆盖/未结转、期初和年度比较、季度/半年、本年累计重叠一致性、来源版本勾稽、金额精度/真实越界/相抵中间和、不可变快照、CSV独立回读/注入与HTML编码分页、流BOM/所有权和I/O失败。

### 与现有规划服务及Reporting同树验证

可选测试项目 `PlanningIntegration/Caiwu.Nonprofit.Reporting.PlanningIntegration.Tests.csproj`与主测试隔离。集成树已含 `src/Caiwu.Nonprofit`时可直接运行；本分支没有复制或修改该owner源码。此次为了验证固定的修复提交，在忽略的临时工具目录只展开仓库现有领域及规则文件：

```sh
mkdir -p .tools/nonprofit-reference
git archive 7b8e8b74dfa4b704b439722573687ee1044ac424 \
  Directory.Build.props global.json src/Caiwu.Nonprofit rules/packages/nonprofit.json \
  | tar -x -C .tools/nonprofit-reference
CAIWU_DOTNET_ROOT=/workspace/caiwu/tools/dotnet bash tools/dotnet-local.sh test \
  tests/Caiwu.Nonprofit.Reporting.Tests/PlanningIntegration/Caiwu.Nonprofit.Reporting.PlanningIntegration.Tests.csproj \
  -c Release -p:TreatWarningsAsErrors=true \
  -p:NonprofitDomainProject="$PWD/.tools/nonprofit-reference/src/Caiwu.Nonprofit/Caiwu.Nonprofit.csproj" \
  --logger 'trx;LogFileName=planning-integration.trx'
```

2项集成测试实际调用既有 `NonprofitPlanningService`：捐赠→支出→分类结转→解除、比较原状态未修改和ProjectedState；同时引用现有Reporting和新DTO/导出验证共存。预期始终是待审投影，不称已记账。首次以警告为错误运行遇到xUnit2031（Assert.Single前使用Where），修为带谓词重载后重跑；重跑后2项通过、0失败、0跳过，构建0警告0错误。

TRX位于各测试项目的忽略 `TestResults/`，未提交机器绝对路径日志。公开的源码测试和锁文件可以复跑，未将测试数量作为功能完成证据。

## 余项与根集成点

1. 根增加solution/引用并接独立WPF面板或DTO；数据源及显式分类已在续作补齐，真实民非账套写入的其他领域边界仍由原owner管理。
2. 续作已实现 `INonprofitStatementDataSource`与来源绑定分类清单，读保存快照并让用户明确补齐缺维度；单月PlanningState本身仍不是真实账簿来源，详见README差异表。
3. 非零一年内到期投资减值的分摊/填列、注册资金直接投入、其他主要收入单列、行业专属披露及完整税务需进一步专业审定；已知事项须传SourceLimitations。
4. Windows真实UI、浏览器打印预览、打印机验收未运行；没有发行安装包、删除保护或声明整体合规。

## 文件用途

| 路径（相对本模块） | 用途与验证 |
|---|---|
| `StatementModels.cs` | 期间、状态、只读UI结果、缺失原因、精确金额及现快照差异；行为测试覆盖，high |
| `BalanceSheetModels.cs` / `NonprofitBalanceSheet.cs` | 显式余额事实与两列公式；手算/缺失/到期/边界测试，high |
| `ActivityStatementModels.cs` / `NonprofitActivityStatement.cs` | 完整窗口、分类/组成/发生额及表样项目计算；手算/分类/期间/结转测试，high |
| `NonprofitStatementReconciliation.cs` | 版本和YTD净资产交叉核对；同源/错源及错口径测试，high |
| `NonprofitStatementExporter.cs` | 独立DTO安全导出适配；独立CSV解析与HTML/流失败测试，high；真实打印未验 |
| `README.md` | API、严格取数含义、来源和根待办，已核代码，high |

## 续作：保存账簿适配与可操作分类界面

收到补充范围后，继续在同一分支补充，未将原两表算法称为已接通用户报表。现有明确入口：

- `LedgerSnapshotStatementDataSource`实际实现 `INonprofitStatementDataSource`，读宿主提供的当前保存快照，从实际末级期初与已记账分录取数；账套/年度/状态/科目/金额不需要用户重抄。
- `LedgerClassificationManifest`及 `ClassificationEditorSession`给出显式科目语义、原分录角色、两类/限制/项目/证据、组成、余额映射/补充分析和覆盖复核。没有根据摘要、名称猜测。
- BookId、revision、规范快照hash、科目hash和凭证ID/分录序号/内容hash共同绑定；源改变、行重排或定位篡改拒绝旧分类。bound preview在导出前重新检查，旧分类不会写出。
- `ClassificationJsonStore`在宿主指定用户数据目录创建新文件，拒绝安装目录、穿越/链接、覆盖旧文件；JSON带内容校验，检查结构、未知/重复字段、枚举、金额精度和来源定位。没有声称主SQLite备份已包含分类JSON。
- 独立 `Wpf/Caiwu.Nonprofit.Reporting.Wpf.csproj`提供可嵌入UserControl：中文科目/分录/余额编辑、组成与复核、校验清单、两表预览、分类JSON往返及CSV/HTML。金额与来源定位只读，主题由宿主继承；没有App/MainWindow或账务写入。

真实Core/SQLite闭环测试位于 `SqliteIntegration/`，与基础测试隔离，新增项目只引用现有模块，不复制其源码。闭环按Core保存→审核→记账，关闭重开SQLite，再显式分类、JSON保存/导入、两表预览、文件导出，最后新增草稿使旧分类/导出失效且旧JSON字节不变。已测试的合成主要金额：捐赠限定1000、成本限定300、分类结转、A范围全额解除200、另增C限制50，银行700/非限定150/限定550。另验证未结转、错误转类组、JSON篡改/过精度、基础余额禁止手填覆盖、编辑缓冲填完后计算、集合排序不影响身份、正负前期调整只列一次，以及科目总额零不能掩盖限制范围未结。

```sh
dotnet restore tests/Caiwu.Nonprofit.Reporting.Tests/SqliteIntegration/Caiwu.Nonprofit.Reporting.SqliteIntegration.Tests.csproj --locked-mode
dotnet test tests/Caiwu.Nonprofit.Reporting.Tests/SqliteIntegration/Caiwu.Nonprofit.Reporting.SqliteIntegration.Tests.csproj \
  --no-restore -c Release -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=saved-ledger.trx'
dotnet build src/Caiwu.Nonprofit.Reporting/Wpf/Caiwu.Nonprofit.Reporting.Wpf.csproj -c Release -p:TreatWarningsAsErrors=true
dotnet build tests/Caiwu.Nonprofit.Reporting.Tests/WpfProbe/Caiwu.Nonprofit.Reporting.WpfProbe.csproj -c Release -p:TreatWarningsAsErrors=true
```

最终已运行：基础35/35、既有规划集成2/2、保存账簿/分类闭环10/10，均0失败0跳过。WPF类库和专用Windows探针已经Linux交叉构建，0警告0错误；曾发现跨程序集访问internal hash助手的编译错误，修为数据源公开只读fingerprint后重建通过。探针源包含实际窗口、DataGrid枚举单元格编辑、预览/JSON往返、来源改变后可见提示与禁用导出、绑定错误检查和合成PNG输出。**当前只有Linux环境，Windows探针未执行，未产生Windows验收结果或真实打印证据。** 根可将 `Wpf/README.md`命令纳入自己的Windows验证，未抢改workflow。

根最小接线：引用WPF子项目，用 `new NonprofitClassificationPanel(ledgerService.GetSnapshot, period, hostChosenUserDataDirectory)`放入既有对话框。无界面调用可载入显式分类后 `source.CreateBoundPreview`，不再要求根另写数据源。详细契约及操作流程见 `src/Caiwu.Nonprofit.Reporting/Classification/README.md`。

剩余：主Desktop入口和Windows实际验证、分类JSON纳入备份/恢复/更新策略、特殊减值/注册资金/行业额外列报等专业边界。现有适配对可推导基础余额禁止手填覆盖；缺事实继续missing，没有大schema迁移或第二套总账。

新增文件置信度：`Classification/*`为读保存快照、typed分类、来源绑定、JSON和共享编辑缓冲，真实SQLite闭环支持，high；`Wpf/NonprofitClassificationPanel.cs`与 `WpfProbe/Program.cs`已交叉构建但未Windows运行，medium/unverified；两份接线README与本轮实测代码一致。
