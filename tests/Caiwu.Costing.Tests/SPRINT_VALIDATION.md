# 成本工作表本轮交接与证据（2026-10-25）

本轮路径 `/workspace/caiwu`，分支 `codex/costing-sprint`；复用既有成本提交 `398ed4a694809089c19308f5f549d3234aa274ec`。没有修改预挂载书库、Desktop/Contracts/Core/SQLite、原安装包派生资料或权限。只改 `src/Caiwu.Costing/**` 与 `tests/Caiwu.Costing.Tests/**`。开工核对时没有仓库AGENTS/相关.agents技能文件；工作区 `.agents` 为空。使用工程交接与证据记录技能，实际读写本文件，不伪造Handoff MCP记录。

## 已验证的功能

- 独立手算：阶段1材料A60/B40，人工80按1:3分20/60，制造费40按3:1分30/10，A110、单位55；B110、单位27.5。阶段2承接两者220，新增材料10、人工20，成品250、5件、单位50。第三阶段新增材料2与制造费5，最终257、单位51.4；成本项目材料112/人工100/制造费45保留。
- 共用材料池40按产量2:4，A13.33、B26.67；B截整26.66另补0.01。对象总额123.33/136.67，合计260。
- 修改实际编辑模型中的第一阶段人工为84，旧建议立即清除；复算A人工21、B63，最终254、单位50.8。导出完整JSON，再导入/复算得到相同导出。编辑元数据、基础、承接和增删行均使旧结果失效。
- 0.01人工、0.02制造费、0.01共用材料按A/B/C相同0.0001基础分配，A各得0.01；B再得制造费0.01，合计0.04。倒序输入与文化变化不改金额、指纹和导出。
- Int64分上限 `92233720368547758.07` 按3:3:4分配，独立预期 `27670116110564327.42`、`27670116110564327.42`、`36893488147419103.23`。
- 三池各自的非零池/零基础拒绝，零池/零基础为0；零成本不生成空凭证。负数/冲回、金额有效精度>2、基础>4、零产量、单项/合计超限拒绝。
- 重复对象/阶段、来源重复使用、跨阶段重复承接、循环/同阶段/未来来源、未知目标及超行数拒绝。未承接的上一阶段对象单独完工，全表不双计承接金额。
- 导出JSON重开；外来账套、错误版本、缺失必填、重复JSON属性、篡改总额/显示单位成本、过大文件拒绝。结果列表只读；调用方数组修改不能改写报告。
- 保存新文件，不覆盖旧字节，不接受账套扩展名，失败无本次临时文件残留；CSV处理引号和公式前缀。仅创建合成测试文件。

## 真实工具链与命令

官方.NET SDK **10.0.402**（runtime10.0.13），下载地址和SHA512取自本仓库 `docs/sdk-metadata.json`，本轮真实校验SHA512通过。SDK装在 `/tmp/caiwu-sdk`，CLI/NuGet/XDG/TMP均在 `/tmp/caiwu-state`；不改HOME/宿主权限、不生成证书或凭据。第一次因命名互斥量临时目录不可用报 `NuGet-Migrations`，设置独立 `TMPDIR` 与 `XDG_RUNTIME_DIR` 后恢复，未发生自动审批拒绝。

使用现有测试依赖及锁文件：Microsoft.NET.Test.Sdk18.11.0、xunit.v3.mtp-off4.0.2、xunit.runner.visualstudio4.0.1。新核心/WPF/探针没有第三方包；只从官方NuGet源还原Windows引用包。

```sh
# 在项目根，dotnet位于PATH并使用可写CLI/NuGet/XDG/TMP目录时：
dotnet restore tests/Caiwu.Costing.Tests/Caiwu.Costing.Tests.csproj --locked-mode --source https://api.nuget.org/v3/index.json
dotnet test tests/Caiwu.Costing.Tests/Caiwu.Costing.Tests.csproj -c Release --no-restore -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=costing-sprint.trx'
dotnet restore tests/Caiwu.Costing.Tests/WpfProbe/Caiwu.Costing.WpfProbe.csproj --locked-mode --source https://api.nuget.org/v3/index.json
dotnet build tests/Caiwu.Costing.Tests/WpfProbe/Caiwu.Costing.WpfProbe.csproj -c Release --no-restore -p:TreatWarningsAsErrors=true
```

最终结果及不可变提交由PR和本轮回传给出。Linux测试TRX在 `/tmp/caiwu-results/costing-sprint.trx`；不以测试数或编译成功声称Windows交互已完成。

## Windows待运行项与最小接入

本容器是Linux，**没有运行WPF窗口或点击验证**。已交付独立STA探针，在Windows上运行：

```powershell
dotnet run --project tests/Caiwu.Costing.Tests/WpfProbe/Caiwu.Costing.WpfProbe.csproj -c Release
# 打开独立合成页面人工操作：
dotnet run --project tests/Caiwu.Costing.Tests/WpfProbe/Caiwu.Costing.WpfProbe.csproj -c Release -- --interactive
```

探针计划执行真实DataGrid单元格编辑、旧结果失效、250→254复算、JSON/CSV保存与重新打开，并检查WPF绑定错误；只写系统临时目录的合成导出。此段是**待运行说明**，不能当已经取得Windows证据。

主集成添加WPF子项目引用并将 `new CostWorksheetPage(bookId, selectedDate)` 挂进现有内容区即可；切账套重建。两个成本项目/测试项目尚未加入根solution，避免抢改主集成文件。本轮边界是可调用、可编辑、可复算、可审核导出的独立闭环；正式总账适配、真实科目映射、持久化CAS/防重、主导航及Windows运行验收仍由主集成完成。没有自动记账路径，不影响原有账套安装/升级保护。

已只读核对最新集成分支 `codex/sprint-integration-2`：当时最新 `1ee0360`，尚无Costing目录/solution入口。原成本PR7仍独立。新PR将以该集成分支为base，包含原成本成果与本轮新增；若根已吸收398ed4，只需本轮新增提交，切勿再次复制整套原模块。

## 本轮最终实测状态

- Linux实际执行领域/编辑/导入导出测试：退出0，**66通过、0失败、0跳过**。其中保留既有36项库存/生产验证；新增部分验证上述实际工作表行为，不以数量代替功能验收。
- WPF组件及STA操作探针真实交叉构建：退出0，**0 warning / 0 error**。未运行Windows探针，仍需Windows验收。
- 两次有价值的失败已修复并回归：保存文件的UTF-8 BOM导致重开失败；编辑器把84.00规范为84导致导出文本不稳定。现在正确处理BOM并统一十进制规范表示。
- 补充核验了Int64上限附近1分钱和大单位成本第6位小数的报告篡改，均会拒绝导入；不依赖浮点近似判断金额一致。
- `git diff --check`通过，新增文件全部位于授权的两个目录。无安装包、数据库、真实业务数据或本地凭据入库。
