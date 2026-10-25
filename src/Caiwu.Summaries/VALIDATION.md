# 摘要库交付证据

日期：2026-10-25 UTC。分支：`codex/summary-catalog`。开发基线：`codex/windows-mvp` 的 `a49d426d8513600dec0f624f56a35c9ad66e71d4`。只新增 `src/Caiwu.Summaries/**` 与 `tests/Caiwu.Summaries.Tests/**`，无新生产 NuGet 依赖。

## 已实现及验证

- JSON 真实落盘与重开；每文件绑定 BookId，独立 CatalogId，分类/摘要稳定 Guid；修订与原文件 SHA256 共同形成乐观版本令牌。
- 分类新增/改名/删除、摘要新增/修改/移动/删除、中文/分类/全角/多词搜索；非空分类禁止删除；同分类重复摘要拒绝。
- 同目录临时文件完整写入和 Flush 后原子重命名，独占锁保护版本比较与发布；损坏输入、未知 schema、缺字段、重复属性/标识、悬空分类均拒绝，原文件不被自动清空。
- 两个服务窗口的陈旧版本冲突；另启真实 .NET 子进程验证陈旧版本返回冲突、锁占用返回 busy、释放锁后成功保存。并发读取与 40 次替换过程中校验快照完整。
- 真实临时文件写入 17 字节后注入 IOException，确认原文件逐字节不变、临时文件清理、旧版本仍能继续正常保存。
- 验证备份字节与收据、结构/BookId/SHA256 校验；有效 JSON 篡改与坏 JSON 均拒绝恢复；已存在目标和源文件均不可覆盖。
- WPF 可绑定的 `SummaryCatalogState` 与显式 `ToPickerItems` adapter；确认返回完整原文，取消保留原分录文字；无结果清除旧选择，错误保留快照但禁用确认。
- 新增可操作的 `Caiwu.Summaries.Wpf` 管理窗口：分类与摘要编辑、搜索、删除确认、明确保存及选择返回，调用同一持久层。独立 `SummaryManagerState` 覆盖草稿不落盘、显式保存、取消、写失败保留输入、捕获版本冲突拒绝、取消后必须重新载入才能继续、中文/emoji 与无效查询。
- 已实际复现独审提出的无效 UTF-16 查询候选：旧选择状态在未配对代理字符抛 ArgumentException 后仍能接受旧项。现查询转换为可读校验错误，两种状态均清选择/结果、禁止接受、保留完整 catalog；正常中文和 emoji 查询可恢复，但不自动恢复选择。此问题不涉及已证明的持久化丢数据。

## 运行命令与结果

Linux，官方 .NET SDK `10.0.402`；SDK 归档已按官方 release metadata 的 SHA512 核验。使用仓库已有 `tools/dotnet-local.sh`，SDK/缓存只写本项目忽略目录 `.tools`。

```sh
tools/dotnet-local.sh restore tests/Caiwu.Summaries.Tests/Caiwu.Summaries.Tests.csproj --locked-mode
tools/dotnet-local.sh test tests/Caiwu.Summaries.Tests/Caiwu.Summaries.Tests.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=summary-manager-tests.trx'
```

锁定恢复成功；最终 **41 passed / 0 failed / 0 skipped**，警告视为错误。原始 TRX 保存在忽略的 `tests/Caiwu.Summaries.Tests/TestResults/summary-manager-tests.trx`，不上传金融数据或构建输出。测试全部为临时目录中的合成内容。

实际 Controls API 编译：从 `bf75d563a325fa257c9097740dbcd0caa2e0b000` 只导出自研 Controls、Contracts 及构建设置到 `/tmp/caiwu-summary-controls-bf75d563`；不改其源码，不提交这些副本。

```sh
tools/dotnet-local.sh build tests/Caiwu.Summaries.Tests/ControlsAdapterSmoke/ControlsAdapterSmoke.csproj -c Release -p:TreatWarningsAsErrors=true -p:CaiwuControlsProject=/tmp/caiwu-summary-controls-bf75d563/src/Caiwu.Desktop.Controls/Caiwu.Desktop.Controls.csproj
```

结果：`net10.0-windows` 桥接项目 **0 warnings / 0 errors**。没有实际运行 WPF 窗口；此结果只证明指定 DTO 与 PickSummary 签名能组合编译。

管理窗口、独立合成宿主和 Windows 回归项目亦已 Release 交叉编译，警告视为错误：

```sh
tools/dotnet-local.sh build src/Caiwu.Summaries/Wpf/Caiwu.Summaries.Wpf.csproj -c Release -p:TreatWarningsAsErrors=true
tools/dotnet-local.sh build tests/Caiwu.Summaries.Tests/WindowsHost/Caiwu.Summaries.WindowsHost.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true
tools/dotnet-local.sh build tests/Caiwu.Summaries.Tests/WindowsSmoke/Caiwu.Summaries.WindowsSmoke.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true
```

**实际 WPF 回归未跑**：当前环境为 Linux，没有 Windows 桌面。已提交 `tests/Caiwu.Summaries.Tests/Run-WindowsSmoke.ps1`，会启动真实模态管理窗口、驱动具名控件及保存事件，校验实际 JSON、取消/关闭不落盘、分类/摘要全套管理、查询、选择、冲突保留输入、Windows 目标文件无 Delete 共享句柄造成的真实替换失败及释放后重试、损坏输入、焦点恢复和新账套重绑定；输出 `smoke.json` 和窗口 PNG，15 秒模态超时且失败非零。尚无这些 PNG 或运行成功结果，未以交叉编译冒充验收。独立宿主带工具菜单，见 README 运行例。

首次测试中一个缺文件断言把缺父目录错误错误地限定为 FileNotFoundException，已修为 IOException 族；服务一直未创建缺失库。后加并发用例触发 xUnit1051，已显式传入测试取消令牌。最终结果如上，不把这两次失败计作通过。

UI 追加验证时，独立宿主曾因 Thickness 缺少四参数构造而编译失败，已修正。无效 UTF-16 的 InlineData 字符串在测试元数据中被替换，改为整数码元参数并运行时构造测试字符串，确实覆盖 `D800` 和 `DC00`，不是替代字符。最终命令均以修正后的源码为准。

## 主集成最小步骤与剩余项

1. 将本分支两个功能提交按顺序合入开发分支，或 cherry-pick 最终报告的提交序列。添加摘要项目/测试到主 solution 与 CI；使用新窗口时给 Desktop 引用 `src/Caiwu.Summaries/Wpf/Caiwu.Summaries.Wpf.csproj`。这些路径不属于本任务，未改。
2. 宿主登记 `(BookId, CatalogPath)`，明确新建与打开的区别；新窗口入口为 `SummaryManagementDialogs.ShowManager(owner, catalog, book.Name, initialSummaryId, focusAfterClose)`，仅 Accepted 时改摘要框。只用旧 Controls 选择器时仍可用 adapter，需 `bf75d563` 或兼容 API；新管理窗口不依赖 Controls。切账必须关闭并用新账套服务重新构造窗口。
3. Delivery owner 按 README 增加独立 JSON 附件登记及整体备份收据；现有 `.caiwu` inventory 只登记 SQLite，不能把 JSON 冒充数据库。租约、数据根保留与升级门控继续生效。
4. 在 Windows 实际验证宿主按钮/双击、取消保持原分录、错误提示、两个管理窗口冲突、切账套与备份登记。Linux 交叉编译与本模块测试不代表 Desktop 已接线或完成 Windows 实机验收。

没有发现阻止本独立模块编译/测试的剩余问题。宿主接线、Delivery 登记与实际 Windows 运行/视觉验收尚未完成；它们是对应 owner 的集成任务。已实现的独立窗口不等同于主 Desktop 已接线，本分支没有占位持久化或解除交付保护。没有安装器发布、原包分析/上传、main 合并、权限修改或新凭据。
