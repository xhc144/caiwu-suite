> 2026-10-26 原版保真工作：新增二维单元格切片见 [Cells/README.md](Cells/README.md)，公共契约与未实现验收见 [reports handoff](../../docs/parity-handoffs/reports.md)。下文是仍保留的旧列公式设计器接口，不作为原版报表完成依据。

# 自定义账表模板编辑器

独立 .NET 10 库与真实 WPF 控件。输入直接使用既有 `Caiwu.Reporting.ReportDocument` 的不可变账表结果，不打开、修改或重新计算账套，不提供任意代码执行。只支持当前 Reporting 的凭证清单、科目余额表、科目明细账；这是一段可集成的有限设计器，不是原商业产品设计器的复刻，也不是法定财务报表映射。

## 最小宿主接入

Desktop owner 添加唯一生产项目引用（无需改 Contracts）：

```xml
<ProjectReference Include="../Caiwu.ReportDesigner/Wpf/Caiwu.ReportDesigner.Wpf.csproj" />
```

```csharp
using Caiwu.ReportDesigner;
using Caiwu.ReportDesigner.Wpf;

// report 必须来自用户当前所见的同一期间/账套快照；不要在这里重取revision并配上旧报表。
var input = new ReportInputSnapshot(report, capturedRevision, sourceLimitations);
var panel = new ReportDesignerControl(input, new ReportDesignerHost(
    IsCurrent: _ => hostStillHasExactCapturedSessionAndReportContext(),
    ChooseTemplatePath: purpose => chooseManagedAbsoluteJsonPath(purpose),
    ChooseExportPath: html => chooseNewAbsoluteExportPath(html)));
var window = new Window {
    Owner = ownerWindow, Title = "自定义账表", Width = 1400, Height = 940, Content = panel
};
window.ShowDialog();
```

示例中的 `hostStillHasExactCapturedSessionAndReportContext`、路径选择函数为宿主职责，并非本库凭空提供的 API。会话校验必须绑定打开设计器时的 **同一 LedgerSession 实例/代次、BookId、revision、报表期间与筛选上下文**；同 BookId/revision 恢复重开也须失效。切账套/恢复/刷新来源时关闭旧窗口并重建；模块从不自动读取新数据配旧模板。宿主可以按有意保留历史快照的产品规则实现回调，但必须明确提示来源已是历史快照。

`IsCurrent` 在预览、保存、载入、导出与打印前检查；路径/打印对话框的嵌套消息循环返回后再次检查。宿主应在 Windows UI Dispatcher 上创建和使用控件。标准 WPF 控件继承宿主主题；本模块不注入应用资源、不修改 Desktop 主入口或原 Reporting。

路径必须是宿主批准的本地受管绝对路径。模板仅 `.json`，导出仅 `.html`/`.csv`。模板目录须已存在，与账套及安装目录分离；宿主负责目录信任、路径授权、租约、生命周期与备份附件登记，不能把模板当作 `.caiwu` 数据库。模块不检查宿主管理目录的父目录权限或防御恶意进程替换父目录。整个 JSON 是完整模板快照；备份可先 Load 再另存到新路径。恢复应使用新路径；不要删除账套/模板来解决保存冲突。

## 实际可操作功能

- 从当前账表字段列表添加列；编辑列键、标题、宽度、显示状态和数值格式；通过上/下移改变列顺序。
- 纯文本标题/页眉、A4 横纵方向、每逻辑页行数；数据网格及真正 FlowDocument A4 页面预览。
- 数值列合计；按一个来源文本字段分组小计，按分组首次出现顺序显示。余额表只累加 `IsLeaf=true`，明细账排除日期为空的期初行；默认不对逐笔余额求和。自定义公式汇总是**逐行公式结果之和**，不是对来源总计再执行一次公式。
- 保存/读回经过校验的 JSON；同一已载入模板保存要求 Id 不变、版本恰好加1、已载入 SHA256 匹配。新路径从不覆盖已有目标；导出也从不覆盖。
- HTML/CSV 导出、Windows PrintDialog 接入。Ctrl+P/页面查看器打印命令走同一来源校验与打印入口。打印取消不会报告已提交；提交成功也不等于实际纸张/PDF已验证。

模板修改立即清空旧结果并禁用导出/打印。错误保留列编辑内容。模板自身没有隐藏审计/告警的选项；BookId、来源期间/revision、账套制度版本、输入快照 Id/内容 SHA256、模板 Id/版本/内容 SHA256、来源说明/缺失限制在数据预览、页面预览和导出保留。源 `ReportDocument.Total` 不重新当数据加入，避免父科目或期初重复合计。

## 公式的精确支持子集

语法：十进制字面量、`[fieldKey]`、`+ - * /`、一元正负、圆括号、`SUM(a,b,...)`、`ABS(x)`、`ROUND(x,n)`；函数名不区分大小写，字段键区分大小写。`SUM` 是**同一行参数求和**，不做跨行检索。`ROUND` 第二参数只能为 0–6 的整数字面量，舍入为 midpoint away from zero。支持计算列引用，循环依赖拒绝。计算列键不能覆盖来源字段；原字段键可用于恒等列 `[同名字段]`。

文本仅能通过直接来源字段引用显示；不支持字符串运算。示例：

```text
[periodDebit]-[periodCredit]
ROUND([net]/3,2)
SUM([debit],-[credit],0.2)
```

中间运算使用约分后的精确有理数，分子/分母各上限512位；最终及被另一列引用的计算列结果必须能**精确**表示为 decimal（96位系数、最多28位小数），否则拒绝，建议显式 ROUND。`1/3` 不会悄悄舍入，而 `ROUND(1/3,6)` 为0.333333。`decimal.MaxValue + 0.01` 也拒绝，避免 CLR decimal 加法静默损失分值。字面量不经会默默舍入的 decimal.TryParse。显示格式 F2/F4/F6/N2/N4/N6 不改变内部数值；CSV保留原始 invariant decimal 数值，HTML/预览/打印使用所选显示格式。

每公式最多512字符、128个AST节点、解析深度32、每函数16参数；最多24列，依赖图无环。输入最多10000数据行；预览默认200行，可设1–10000。截断始终显示数量和警告，合计仅含当前行，**禁止导出/打印截断结果**。即使隐藏的列也校验并逐行求值；缺字段、文本参加运算、除零、非法语法、溢出/精度丢失均报列/字符，数据相关错误另报原数据行（1起算），不填0、不保留貌似有效的旧预览。

## JSON/导出与现有 Reporting 的关系

JSON schema=1，最大128KiB，拒绝缺少必需属性、重复/未知属性、数字枚举、未知schema、无效列、公式语法及列循环；当前字段类型/来源一致性另由 Preview 校验。WPF 载入和保存都会对固定输入实际 Preview。JSON只保存声明式模板，不保存账套连接、SQL、源数据或执行程序。

同目录独占 sidecar `.lock` 为协作写者提供并发保护，锁文件保留避免 inode 锁分裂；保存先完整写入并 flush 同目录随机暂存，再原子发布。新文件在 Unix 使用 `link(2)` 原子不覆盖（文件系统不支持则报错，无危险 fallback），Windows 使用固定 .NET10 的不覆盖 move；更新在持锁且 hash/version 匹配后原子 replace。此协议覆盖使用本模块的窗口/进程；非协作外部程序仍须由宿主目录策略约束，不声称断电耐久性/网络盘支持已验收。

输入类型、金额/文本区分、来源元数据与总计语义直接复用 Reporting。现有 `ReportDocument/ReportRow/ReportCell` 构造器为 internal，公开 exporter 不能接受自定义列，因此本模块提供受限列的安全 renderer，复用已审的 RFC4180、危险CSV文本加单引号、HTML编码、CSP、流所有权与分页策略，并与真正 `ReportExporter` 做攻击文本一致性测试。没有通过反射调用 internal 构造器。

给 Reporting owner 的最小后续建议：提供公开的、校验过的自定义呈现投影工厂/格式化扩展点，才能进一步合并通用导出实现；不要为接入本控件扩大 Contracts，也不应让 root 直接暴露可变金额单元格。当前自定义 renderer 已能独立导出，非等待该建议的占位实现。

HTML无脚本/远程资源/模板HTML插入，来源显示为编码后的纯文本；CSV文本与元数据全部防公式注入，数值保留decimal。宽度按比例适配纸宽，逻辑页重复审计与告警；长文本可能增加物理页，窄列可能不易读，实际打印须检查页面预览。TextWriter 由调用方持有且不会被关闭；文件导出写完后才发布，不留半个目标。

## 尚未覆盖

未实现原版任意拖拽画布、合并单元格、跨表/跨期间取数、Excel导入、图表、数据库查询、宏/脚本、动态行/交叉表、条件格式、可执行外链、完整法定报表/税表/附注、PDF生成引擎和完整原版设计器。源字段缺失不会由本模块猜测补齐。存在来源限制的输出始终携带限制，不签发正式完整财报。

实际本轮证据与运行命令见 `tests/Caiwu.ReportDesigner.Tests/VALIDATION.md`，Windows 程序见 `Run-WindowsSmoke.ps1`。主菜单/会话接入、受管模板目录与备份登记由 root/Feature owner 完成；Linux交叉构建不代表 Windows 操作/打印/PDF/高DPI验收。
