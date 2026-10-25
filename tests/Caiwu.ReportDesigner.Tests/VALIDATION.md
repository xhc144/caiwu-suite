# 报表设计器验证与剩余验收

2026-10-25，独立 `/workspace/caiwu-report-designer`，分支 `codex/report-designer`，基于最新检出的 `codex/sprint-integration-2` **b3b85eb3ab7fa859a3c44cca5bb6d25d48d7b434**。所有输入、账户、人名、来源链接和导出均为自写合成样本。预挂载书库、原安装包及其派生资料未读取/修改/上传。

## 实际通过的行为

- 独立手算：100.10−10.00=90.10；30.20−20.10=10.10；末级合计100.20，父行100.20仅展示，不重复计入。逐行ROUND(净额/3,2)分别30.03与3.37，合计33.40。
- 完整编辑闭环：列重排、标题/宽度/公式变更，改为逐行再加0.2后末级合计100.60；JSON保存/加载，预览内容及模板语义hash一致；HTML/CSV输出、BOM、独立RFC4180解析和矩形列数均核验。
- 公式：四则优先级、正负号、SUM/ABS/ROUND、半值远离零、0.1+0.2、28位小数、非终止除法、decimal极值与静默精度损失拒绝、512位中间数限制、字面量拒绝默默舍入。未知字段/类型、隐藏列错误、直接/间接循环、深度/节点/长度/函数参数限制均拒绝。
- 上下文与布局：三个既有Reporting来源类型、末级/期初汇总语义、来源类型不匹配、不可变结果/模板、输入hash、分组小计、A4横纵向宽度适配、逻辑页数及每逻辑页审计标记、截断后禁止导出。
- 保存保护：新目标不覆盖、精确hash/version冲突、独立并发调用仅一方成功、锁占用、发布失败保留原目标与只清理自身暂存、JSON缺失/重复/未知字段/schema/语法/循环拒绝。未声称已用独立进程或断电测试证明模板保存耐久性。
- 安全导出：实际调用旧 `ReportExporter` 与新renderer比较危险文本的CSV/HTML行为，覆盖空白/控制符/Unicode format字符/全角危险前缀/引号/换行/HTML标签。无脚本、远程资源或可执行模板插入；I/O失败传播，TextWriter不被关闭。
- 真实Core+SQLite闭环：企业合成账套期初100000/100000；采购10000、费用1200、收入20000经SaveDraft→Review→Post，关闭重开后Reporting银行余额108800、本期借贷各31200、期末借贷各120000。设计器净额列总和0，改为千元公式得银行108.80，保存/加载/导出；完整快照序列化前后（含账户、凭证、audit、revision）相同。

本轮最终单元/行为测试 **57通过、0失败、0跳过**；独立真实Core/SQLite集成 **1通过、0失败、0跳过**。这些数字描述验证范围，不代表完整产品或完整设计器功能完成。原始 `evidence/designer.trx`、`evidence/integration.trx` 与合成的 `synthetic-template.json`、`synthetic-report.html`、`synthetic-report.csv` 随提交保存。样本中的输入/模板hash绑定当次生成内容，随机模板Id/快照Id会使重跑样本hash不同。

## 可重跑命令

使用官方 .NET SDK **10.0.402**。SDK通过官方builds.dotnet.microsoft.com安装在独立工具目录；未改book-project。生产项目无新增NuGet依赖，测试复用现有项目的固定官方包，依赖hash在各 `packages.lock.json`。

```sh
dotnet restore tests/Caiwu.ReportDesigner.Tests/Caiwu.ReportDesigner.Tests.csproj --locked-mode
dotnet test tests/Caiwu.ReportDesigner.Tests/Caiwu.ReportDesigner.Tests.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true

dotnet restore tests/Caiwu.ReportDesigner.Tests/Integration/Caiwu.ReportDesigner.Integration.Tests.csproj --locked-mode
dotnet test tests/Caiwu.ReportDesigner.Tests/Integration/Caiwu.ReportDesigner.Integration.Tests.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true

dotnet restore tests/Caiwu.ReportDesigner.Tests/WindowsSmoke/Caiwu.ReportDesigner.WindowsSmoke.csproj --locked-mode
dotnet build tests/Caiwu.ReportDesigner.Tests/WindowsSmoke/Caiwu.ReportDesigner.WindowsSmoke.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true
```

Linux设置 `CAIWU_DOTNET_ROOT=/workspace/caiwu-tools/dotnet` 后可用既有 `tools/dotnet-local.sh` 代替dotnet；缓存均落新项目`.tools`，不改HOME。可选 `CAIWU_DESIGNER_EVIDENCE=<absolute directory>` 令完整闭环用例复制当次合成JSON/HTML/CSV用于检查；默认测试只写临时目录并清理。

实际 WPF 控件及 WindowsSmoke 严格Release交叉编译 **0 warning / 0 error**，`evidence/windows-cross-build.txt` 是编译记录。中途缺少System.IO using、一次smoke相对项目路径和PageViewer属性拼写错误已在最终构建前修正；未把这些编译失败当作运行故障或抹去实际未验边界。

## Windows需执行

```powershell
./tests/Caiwu.ReportDesigner.Tests/Run-WindowsSmoke.ps1
./tests/Caiwu.ReportDesigner.Tests/Run-WindowsSmoke.ps1 -Interactive
```

自动模式75秒进程内watchdog、90秒脚本watchdog；默认唯一临时输出目录。探针启动真实WPF窗口，通过DataGrid.BeginEdit/实际TextBox/CommitEdit与真实按钮路由处理器执行公式/标题/宽度修改、清旧预览、重新预览、保存、第二次修改、读回、HTML/CSV导出、冲突保留输入、除零定位、陈旧会话拒绝；生成真实FlowDocument paginator并输出WPF RenderTargetBitmap PNG与smoke.json。按钮通过路由事件调用，**不是物理键盘或原生鼠标输入认证**。PNG是实际WPF渲染，**不是BitBlt桌面原生截图**。交互模式展示同一真实组件，由用户手工验证选择字段、移动列、方向、页面预览与打印对话框。

本环境为Linux，没有Windows桌面/Windows打印机，也没有pwsh；**上述Windows实际执行、PowerShell运行解析、PNG、DPI/IME/辅助技术、打印对话框、真实纸张与PDF均未验证**。cross-build不是Windows smoke通过，模板/HTML测试不是PDF/打印通过。脚本及探针已交付，不填写虚构Windows证据。

## root/Feature owner的最小剩余工作

1. 将本模块提交接入集成分支；添加 `src/Caiwu.ReportDesigner/Wpf/Caiwu.ReportDesigner.Wpf.csproj` 项目引用，按模块README挂载窗口/菜单。当前菜单未接通，不宣称Desktop已有该入口。
2. 从同一已显示报表快照传入revision/period/BookId；实现精确会话代次及筛选上下文校验，来源切换关闭旧窗口。
3. 给独立受管模板目录、路径选择与模板JSON的备份/恢复附件登记；保留现有安装/升级/账套保护和DELIVERY_PAUSED。
4. 在Windows运行上述自动/交互smoke，检查页面预览、真实打印、实际PDF驱动输出及主题/DPI。失败时保留JSON/异常证据，不把未执行写为通过。
5. 若要进一步共用Reporting导出内核，请由Reporting owner新增校验过的公开自定义投影/格式化扩展点；现有internal构造器阻止直接投影，本实现没有越界修改它们，也没有反射绕过。
