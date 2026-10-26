# Payroll 第一切片验证

2026-10-26 UTC；下表保留初片源码 `dbf6bd271f7d8a1dba4917463e3a70882fe3b98f`、src树 `2b6227c30473553a21b9306ea5b535f05474c856` 的历史验证。当前P1返修源码 `a4ddcf9361c8b10871b4ec948b5f875144aba2e9`、src树 `14507248687906fb639b8fc51de749eda244b4bf`，本次新增结果另列，不冒充旧证据重跑。

环境为Linux、官方SDK10.0.402，SDK/NuGet/runtime在 `/workspace/caiwu-tools`；未改book-project/系统SDK。命令用工作区DOTNET_CLI_HOME、NUGET_PACKAGES、XDG_RUNTIME_DIR，不涉及凭据。

| 实际命令 | 结果 | 证明范围 |
|---|---|---|
| `dotnet test tests/Caiwu.Payroll.Tests/Caiwu.Payroll.Tests.csproj -c Release -warnaserror -p:RestoreLockedMode=true` | exit0，35通过/0失败/跳过 | 部门人员/月快照、90字段/NULL/原属性、依赖/条件/语法限界/计算回滚、批量保存、CAS、平衡计划/来源幂等、虚构税参数fixture、CSV等合成行为 |
| `dotnet test tests/Caiwu.Payroll.Tests/IntegrationTests/Caiwu.Payroll.Integration.Tests.csproj -c Release -warnaserror -p:RestoreLockedMode=true -p:ParityContractsProject=/workspace/caiwu-contracts-frozen/src/Caiwu.Contracts/Caiwu.Contracts.csproj` | exit0，7通过/0失败/跳过 | 冻结PR52接口替身：不换token/重试、未存变更不能删维度后转入、辅助拒绝、未知JSON高精度保留、失败不标成功、提案组成/收据重开；不证明真实Core/SQLite |
| `dotnet build tests/Caiwu.Payroll.Tests/WindowsSmoke/Caiwu.Payroll.WindowsSmoke.csproj -c Release -warnaserror -p:RestoreLockedMode=true` | exit0，0警告/错误 | Wpf模块库和Windows新实现探针可编译；Windows GUI未执行 |
| `dotnet run --project tests/Caiwu.Payroll.Tests/ReopenProbe/Caiwu.Payroll.ReopenProbe.csproj -c Release -- create /tmp/caiwu-payroll-final-20261026.payroll.sqlite 566d4ddf-9e6c-448b-b5ae-8ef06c2446cf` | exit0，created、revision9 | 第一进程建立全新独立合成文件、保存工资/计划并退出 |
| 另一进程，同项目 `-c Release --no-build -- read`，同路径/ID | exit0，reopened、revision9、netWages3350.25、plans1 | 实际持久化重开，并断言第80栏6700.50、尾空格、已计算和计划状态，无真实账套 |

契约目录用 `git archive 5bb60d24b9c60c9eecfcc5adc37bced4688adf85 src/Caiwu.Contracts Directory.Build.props` 在单独目录解出，只验证准确接口；未编辑/cherry-pick共享文件，也未把替身接口放入产品源。日后已集成公共接口可去掉ParityContractsProject覆盖。

数据全部合成。税表标为虚构，example.invalid不是法律来源；没有预装真实税务参数或称法律适用。独立SQLite未接主账套备份/恢复，不是原SQL Anywhere兼容证据。

## P1返修验证：凭证设置与旧计划

先在396b304业务代码上增加 `SavedVoucherSettingChangesRejectOldPlanWithoutWritingAndRegenerateCorrectAccounts`，运行同一IntegrationTests命令，附 `--filter FullyQualifiedName~SavedVoucherSettingChangesRejectOldPlan`：exit1，3例失败，均为 `Assert.Throws() Failure: No exception was thrown`。路径分别为Payment改应付、Payment改贷方、Distribution改应付。确认静审问题存在；这些是合成接口替身调用，不是真实总账写入。

修复后a4ddcf9使用上述相同Release/警告视错/锁定restore命令：

| 验证 | 实际结果 |
|---|---|
| 模块业务测试 | exit0，36通过、0失败/跳过；新增SQLite实际落盘/重开验证设置版本失效、旧计算拒绝、新计划ID与正确科目 |
| 冻结接口替身测试 | exit0，12通过、0失败/跳过；新增3条旧计划路径、已转入来源拒绝重生成、同设置旧窗口仍CAS |
| WindowsSmoke Release构建 | exit0，0警告/错误；仅交叉编译，未运行Windows |

3条原复现路径均从新的ModuleLedgerSnapshot重开会话后再次尝试旧planId；拒绝前后JSON和revision不变、ProposalCalls=0、收据为空。仅重新计算仍拒绝旧ID；显式重新生成保留SourceKey但换ID，旧ID再调用不写入；新计划提交中使用新科目、不含旧科目，收据重开正确。已转为草稿的旧来源不能借设置变更重新生成；未改设置的保存不推进配置版本但仍走全账套CAS。

本次只返修PR50已有首片，未追加模块/改公共接口/改技术栈。35+7旧测试不能冒充此缺陷原已覆盖；其余审查项尚未全部返回，未称全审通过。

## 尚未执行

`WindowsSmoke/run.ps1 -OutputDirectory <NEW-DIR>` 需Windows桌面会话。探针通过实际WPF handler测试部门存盘/员工新增/最后编辑格提交/计算/生成计划/重开，输出144DPI PNG及source SHA、环境、逐项结果；本轮只编译，不提供虚构截图或成功结果。

实际Windows仍需检查相对位置、DPI遮挡、Tab/焦点、Ctrl+S/A/D/F4作用域、脏数据是/否/取消、失败留窗/保留输入、两窗口旧revision冲突、原主壳MDI/权限/日期及工资→总账草稿闭环。原版程序未运行；原版模式/像素/工具栏/完整列视觉关系未验，静态坐标不能替代。

完整未实现清单见 [handoff](../../docs/parity-handoffs/payroll.md)。不以测试数量换算完成率，不缩小原版验收。
