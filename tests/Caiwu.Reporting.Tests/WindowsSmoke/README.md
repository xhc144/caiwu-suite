# 新账簿 WPF 的合成 Windows 验证

本工程不运行原程序，不读取真实账套。当前仅在 Linux 交叉编译，**尚未在 Windows 运行**；没有本轮 PNG 或 Windows 通过报告。测试文件扩展名 `.cs.windows` 由此项目明确编译，避免进入 Linux 的根测试项目。

在真实 Windows/.NET 10.0.402、可用桌面会话中，从 repo 根执行：

```powershell
dotnet run --project tests/Caiwu.Reporting.Tests/WindowsSmoke/Caiwu.Books.WindowsSmoke.csproj -- . .\TestResults\books-new-wpf-unique
```

输出目录必须不存在。执行三组真实新 WPF 条件窗确认及结果窗，校验计算结果、移动、联查 BookId/Revision/VoucherId、年度边界和返回；按既有 windows.json 检查各产品相同对象中可证明的控件相对起点顺序，保存六张新窗口 PNG 和 `books-new-wpf-smoke.json`。事件通过新窗口的真实 handler 调用，未模拟原程序，更不是原版运行对照；原版验收字段始终 `not-run`。

人工查看入口：

```powershell
dotnet run --project tests/Caiwu.Reporting.Tests/WindowsSmoke/Caiwu.Books.WindowsSmoke.csproj -- --interactive
```

该入口明确是独立合成验证壳。它不代表生产主菜单已经接线。原产品应由 shell 将模块条件窗和 `BooksResultView` 放在原菜单/MDI 路径。

Windows 后续必须另验：100%/150%/200% DPI、输入焦点/展开下拉/滚动和文字遮挡、Ctrl+P/Ctrl+F4、科目搜索方向键/Enter/双击、取消及年度重选、CSV/HTML 实际保存取消/失败、打印预览分页和真实打印机、宿主凭证权限与联查、主框架 MDI 生命周期。原打印格式、原账套与所有原版功能仍以完整项目验收清单为准。
