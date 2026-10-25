# 金融组件 Windows 验收交接

2026-10-25 UTC。本组已完成，实际验证源码 **`6db23d198b2215ec5a1e91fed0e3c62824ac2493`**；[Windows CI 40188184523](https://github.com/xhc144/caiwu-suite/actions/runs/40188184523) 成功，11:18:29 UTC 结束。工作从10:56 UTC开始，11:22 UTC前完成代码、截图检查和交接保存，早于12:15截止。仅本组；没有运行全球套件、安装或原软件。

[最终结果 JSON](evidence/6db23d1/financial-results.json)、[人工视觉复核](evidence/6db23d1/visual-review.json)、[artifact 身份](evidence/6db23d1/artifact.json) 及同目录10张原生PNG、合成JSON/HTML/CSV均已保存。artifact ID `12596967331`，ZIP SHA256 `25f1b505044f38ce3781fc1aad825490d586adb1ca18369673501a52356252a1`，与下载后计算一致。所有PNG的文件哈希及1920×1080尺寸逐个核对一致。原始进度快照不是最终结果；Git证据副本省略该未完成快照，不改变最终JSON或PNG。

## 实际业务结果

| 控件 | 实际完成及证据 |
|---|---|
| CostWorksheetPage | 真实人工单元格80→84后250→254；审核JSON保存、加载到实际编辑器并复算254；旧文件和跨账套导入拒绝；原生保存/打开取消无文件副作用；等权一分钱A得0.01、B/C得0且总额守恒；无效空输入留窗、清旧结果/建议；金额右对齐。见 `costing-*.png` 和 `costing/`。 |
| NonprofitClassificationPanel | 实际重开合成SQLite账簿；未分类保持缺失；真实枚举单元格与原生中文证据编辑；明确分类后两表勾稽通过，资产110、非限定捐赠10；原生保存/导入分类JSON并重算；两表HTML/CSV导出；保存/重置/导出取消无副作用；分类编辑拒旧导出并清旧预览；源在原生导出选路径期间被Core保存草稿改变后，不创建目标文件、拒旧JSON及零字节bound导出、禁用保存/导出并清预览。分类/预览/文件操作前后账簿快照相等。见 `nonprofit-*.png` 和 `nonprofit/user-data/`。 |
| ReportDesignerControl(input, host) | 实际列标题/公式/宽度编辑；末级独立合计100.20→100.60；保存→第二次编辑→读回→重新预览；实际HTML/CSV按钮导出、页眉HTML编码；取消不改文件；重复导出及模板并发冲突保留原文件和编辑；除零定位且清旧预览，截断禁导出/打印；选路径期间来源变更及账套/期间/会话改变均拒绝，文件哈希不变。格式下拉框实际尺寸及最终原始PNG确认不再裁切。见 `designer-*.png` 和 `designer/`。 |

三个实际控件均从生产程序集加载确切 `Themes/Modern.xaml`，断言Window/按钮样式引用与中文字体继承。该主题文件与指定 `98a43e0` 无差异，blob为 `f8c13a3880938586f606b8a984bff44fc591758d`。绑定错误为空。普通中文、ASCII及标点均通过前台焦点核验后的native SendInput进入实际文本框并核对编辑缓冲。

最终PNG逐张检查：完整客户区和动作按钮无裁切，正常结果数字右对齐，中文无方框，设计器F2/F4可完整辨认；错误窗口保留输入，旧预览清空。长表和审计文本通过控件的正常滚动查看，不声称一张截图展示所有行。

## 已修的小缺陷与可挑选提交

| 提交 | 改动 |
|---|---|
| `a2bd397d5aed2d722134d9474c95f186b99073ac` | 设计器 `RowHeight="Auto"` 虽可编译，却在实际加载时抛XAML Double转换异常；移除非法值。 |
| `60756fca1f4f511eca6dcb64f5e2634881fd8da2` | 成本输入/输出及民非预览数值右对齐；民非按钮校验失败时清空旧预览。只改两个组件WPF文件。 |
| `f6cb88538724d12580128683d1489186b35dc9de` | 设计器格式选择器被30像素行压住；行高48、格式列宽110，实际单元格内可完整显示。 |

没有改计算模型、Contracts、Core、Storage、Desktop主入口或主题。未发现需要本组越权修复的计算逻辑问题。

## 集成方式

草稿 [PR31](https://github.com/xhc144/caiwu-suite/pull/31)，分支 `codex/module-financial-ui-qa`，基于 `10e38ff` 的现有集成代码；后来 `8cf5d43` 只补根交接证据，与本组Core/Storage无差异。对应源码树指纹：Core `a4a0239e97b433708fe727d9e4ee2eca03ca793b`，Storage `ce45cb6c52a7e980b43adbd7d8da65f1c6ff7a9d`。

本分支的 `6a985b3` 是作者设计器 `03ee6da` 的原样依赖提交。若根已经具备作者完整提交（包括 `tests/Caiwu.ReportDesigner.Tests/SyntheticFixture.cs`），不要重复挑选 `6a985b3`。成本/民非树已经等于指定af0d0e3/cb71350b，无需再挑选它们。

其余代码按现有顺序挑选即可：

```sh
git cherry-pick 576bd73 a2bd397 f1df7d2 7deb797 60756fc 5d4893e f6cb885 ce71fd4 6db23d1
```

无需改solution。在候选Windows job运行 `./tests/Caiwu.ModuleWindowsQA/Financial/run.ps1` 即可；新增workflow只允许本QA分支运行，不会接管主交付工作流。根接入真正宿主后，应在其候选源码SHA运行该组并保留主宿主自身验收，不能把本独立宿主结果当作主入口集成通过。

生产宿主继续负责：设计器同一会话代次/BookId/revision/期间/筛选守卫和受管文件路径；民非每次读取真实已保存快照及分类sidecar保管/备份；成本换账或退出时关闭旧页。此组明确命名的合成宿主只服务测试，不提供生产匿名绕过。

## 诊断记录

| 源码 / CI | 事实 |
|---|---|
| `576bd73` / 40187129523 | 真实发现设计器XAML启动异常；另两处为探针选到TextBox模板内部按钮、文件名未提交。保留原始失败JSON。 |
| `f1df7d2` / 40187264132 | 成本打开对话框过早Escape被初始化吞掉；180秒限制正确失败。保留最后stdout和timeout。 |
| `7deb797` / 40187640740 | 成本业务链通过后金额左对齐失败；设计器完整通过；民非保存通过、导入文件名控件尚未就绪。保留JSON/原生对话框记录。 |
| `5d4893e` / 40187841065 | 三组全部通过；随后逐张看图发现格式下拉框裁切，进行局部WPF修复。 |
| `ce71fd4` / 40187974551 | 成本/设计器及新格式几何均过；民非长文件名仅消费到前缀时探针拒绝。保留失败JSON；改为有界等待完整native输入消费。 |
| `6db23d1` / 40188184523 | 最终三组完整通过，10张PNG及所有最终JSON/导出样本已核对。 |

本地 `.NET SDK 10.0.402` Release交叉构建，`RestoreLockedMode=true`、`TreatWarningsAsErrors=true`，0警告/0错误；Windows运行时 `.NET 10.0.13`。交叉构建与真实交互结论分别记录。

## 未覆盖与阻断

没有权限阻断或待定远端写入。代码已推私有分支、PR仍为draft；未合main、改仓库权限、生成凭据或发布安装包。

未运行：真实打印机提交、PDF输出、物理键盘/IME组合输入、其它DPI/小分辨率、生产Desktop身份/会话/菜单集成、安装/更新及账套保留。民非分类sidecar未接入主账套备份；成本控件没有会话回调。它们属于根/相应owner的后续验收，不标为通过。没有读取原安装包、真实原窗口/SQL/对象目录或生成派生catalog。

文件用途置信度：本目录三个Case、NativeWindows、run.ps1与聚焦workflow为high（实际Windows行为/截图/失败证据）；生产主宿主集成为unverified（没有改或运行）。证据副本是本轮项目记录，不冒充Handoff MCP事件。
