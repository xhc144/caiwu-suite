# 二维报表切片验证

2026-10-26 UTC；基线 main@3b0c59b；模块分支 codex/parity-reports-20261026。精确产品提交见同 PR 与 reports handoff 的后续证据记录。

## 环境与命令

Linux x64；.NET SDK 10.0.403（global.json允许10.0.402的latestPatch）。SDK/CLI/NuGet缓存均在临时目录。默认沙箱首次运行失败：只读CLI默认目录；改临时缓存后NuGet-Migrations命名锁仍无法创建。请求的单纯构建/合成测试沙箱外执行获自动审批并成功，无拒绝/待批准操作；无需改变仓库权限或系统全局配置。

复现核心测试：

```sh
dotnet test tests/Caiwu.ReportDesigner.Tests/Caiwu.ReportDesigner.Tests.csproj -c Release --logger 'trx;LogFileName=cell-parity.trx'
dotnet build tests/Caiwu.ReportDesigner.Tests/CellWindowsSmoke/Caiwu.ReportDesigner.CellWindowsSmoke.csproj -c Release -warnaserror
```

公共适配器需先在临时副本或集成checkout应用 PR52 的固定契约；不把它复制进基线共享目录：

```sh
dotnet test tests/Caiwu.ReportDesigner.Tests/ParityIntegration/Caiwu.ReportDesigner.Parity.Tests.csproj -c Release
```

## 具体验证

合成账务独立手算：现金两个末级期初1000+500；1月借200；2月贷150与借50；未过账借900排除；3月借600排除。2月期初1700、期末1600、本期借50/贷150、累计借250/贷150，单元格依赖结果1600。矩形SUM与ABS/ROUND结果205.33。

真实本地I/O闭环：创建JSON、hash读回、保持行高0.4英寸/列宽22.5字符/四位千分位、重新计算、HTML/CSV新文件导出；验证HTML编码和尺寸、CSV引号、不覆盖现存导出、旧hash更新冲突保留文件。严格重复JSON键/未知字段拒绝，注入文本防护、缺科目/父科目显式汇总、循环/除零/精度错误、快照身份、输入复制、覆盖区间、长依赖链和预算有独立行为测试。

公共契约合成验证：同一book/revision提交；不重新GetModuleSnapshot；只变更一个reports文档；原始JSON字符串、未知envelope数值保留；拒绝未知schema；CAS失败原样传播；没有足够无辅助/外币/数量/未知列证据时拒绝简化DTO取数。测试服务是记录参数的fake，未连接真实Core/SQLite。

## Windows 状态：未运行

WPF/独立宿主严格交叉编译不等于Windows执行。可在Windows运行：

```powershell
dotnet run --project tests/Caiwu.ReportDesigner.Tests/CellWindowsSmoke/Caiwu.ReportDesigner.CellWindowsSmoke.csproj -c Release -- --exercise --out=C:\synthetic-report-evidence
```

目录须为新目录。宿主真正打开WPF窗口，编辑DataGrid公式，触发“生成”按钮，存盘/读回/重算/导出，保存合成窗口PNG与result.txt；失败写failure.txt并退出1。无--exercise时可人工操作三个格式对话框、数字格式、打开存盘和菜单。它不运行原程序，不读取真实账套。

Windows仍需验证实际焦点、Enter/取消/快捷键、DPI、字体、对话框比例、全表编辑与未保存拦截、文件锁与原子替换；完整函数向导/生成参数窗口、打印/页设置等仍未实现，原版与真实账套验收均未通过。
