# 独立金融组件真实 Windows 验收

本项目只打开 `CostWorksheetPage`、`NonprofitClassificationPanel`、`ReportDesignerControl(input, host)`，不启动生产 MainWindow、不登录、不提供生产匿名身份、不运行安装程序。仅合成账套；分类侧实际创建并重开 SQLite 测试账套，验收结束后把账套留在本次 artifacts 目录，不打包或上传数据库。

## 运行与证据

```powershell
./tests/Caiwu.ModuleWindowsQA/Financial/run.ps1 -OutputDirectory artifacts/financial-windows
```

必须在可显示桌面的 Windows 上运行，SDK 为仓库固定的 .NET 10.0.402。脚本只编译依赖及此组，单进程内部限时 180 秒，外部限时 210 秒。任一真实失败返回非零；其他独立组件仍会继续，超时明确失败。每组结束立即写 `financial-results.json`；分支限定 workflow 在成功或失败时均上传证据。

- `financial-results.json` 含精确源码 SHA、逐组件断言、实际失败堆栈、绑定错误、截图 SHA256 与原生窗口几何。
- `financial-progress.json` 仅为中间未完成快照，不能替代最终 `financial-results.json`。
- PNG 使用现有 `HighResolution` 探针相同的原生主桌面 BitBlt 路径，1920×1080，不裁剪、缩放或拼图；核对前台 HWND、完整客户区和动作按钮边界。
- 成本与设计器的 JSON/CSV/HTML、民非用户目录的分类 JSON/两表导出保留为合成证据。分类 JSON 不在主账套备份内。
- 原生文件对话框只选此次测试目录或取消；若找不到实际控件则失败，不替代真实结果。

Linux 可使用 `tools/dotnet-local.sh build tests/Caiwu.ModuleWindowsQA/Financial/Caiwu.ModuleWindowsQA.Financial.csproj -c Release -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true` 交叉构建；这不代表 Windows 验收通过。

## 来源与集成

基线为 `10e38ff` 集成树；与后来根分支 `8cf5d43` 相比 Core/Storage 无差异。成本和民非源码分别逐文件核对为 `af0d0e34ab9963fc91cabb8a58aed558b34390f0`、`cb71350b2b19067e7a8704b74985d8cf0f15e1aa` 的精确树。

设计器作者提交 `03ee6dac47a7cc1c61f303f3c5e214245f87017d` 以独立依赖提交 `6a985b3` 载入；根若已有该模块，只取本目录、聚焦 workflow 和单列的 WPF 小修提交，不必重复载入作者提交。没有改 solution、主 Desktop、主题、Contracts、Core 或 Storage。

成本 DataGrid 编辑及 JSON API 沿用作者 `1d0ff00` 的 `WpfProbe`；民非显式分类模型、两表手算例和编辑方法沿用 `cb71350` 的 `WpfProbe`/SQLite 示例；设计器直接编译作者 `SyntheticFixture.cs`，复用 `03ee6da` 的 WindowsSmoke 编辑方式。原生截图/输入布局取自现有 `HighResolution` 和 `NativeFocus`。没有读取原安装包或生成原包派生资料。

三个控件放在普通独立 `Application`/`Window` 中，加载生产程序集的确切 `Themes/Modern.xaml`，不复制或伪造主题。`SyntheticDesignerHost` 是明确的测试宿主，每次比较 BookId、revision、期间、会话、输入对象身份；测试取消、来源在选路径时改变和来源会话切换。生产宿主仍须提供自己的生命周期和受管路径。成本控件只有固定 BookId/日期，没有会话回调；跨账套 JSON 拒绝在此组覆盖，主宿主在换账/退出时关闭旧页的行为须由主集成验收。

## 覆盖与边界

成本：真实编辑 250→254、审核 JSON 读回、拒覆盖/跨账套、原生打开/保存取消、等权一分钱尾差、错误留窗且清空旧建议、金额对齐。民非：未分类保持缺失、真实枚举与中文证据编辑、明确分类→两表勾稽→原生保存/导入/HTML/CSV、重置/路径取消、分类与导出不写账簿、来源改变拒旧分类与零字节导出。设计器：真实列/公式/宽度编辑→预览→保存/读回→HTML/CSV、转义、冲突、错误/截断、取消、来源在选路径时改变、账套/期间/会话失效。

常规中文、ASCII、标点使用已核对焦点的 native SendInput Unicode；未跑物理键盘或 IME 组合输入。未提交打印作业、未生成或检查 PDF、未验主 Desktop 宿主、未验安装/更新账套保留。WPF 文档对象或编译成功不能替代这些结论。

最终运行及返修记录见 [VALIDATION.md](VALIDATION.md)；以其中源码 SHA 对应的 JSON/PNG 为准。
