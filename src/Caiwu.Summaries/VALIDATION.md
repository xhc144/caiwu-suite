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

## 运行命令与结果

Linux，官方 .NET SDK `10.0.402`；SDK 归档已按官方 release metadata 的 SHA512 核验。使用仓库已有 `tools/dotnet-local.sh`，SDK/缓存只写本项目忽略目录 `.tools`。

```sh
tools/dotnet-local.sh restore tests/Caiwu.Summaries.Tests/Caiwu.Summaries.Tests.csproj --locked-mode
tools/dotnet-local.sh test tests/Caiwu.Summaries.Tests/Caiwu.Summaries.Tests.csproj --no-restore -c Release -p:TreatWarningsAsErrors=true --logger 'trx;LogFileName=summary-tests.trx'
```

锁定恢复成功；最终 **32 passed / 0 failed / 0 skipped**，警告视为错误。原始 TRX 保存在忽略的 `tests/Caiwu.Summaries.Tests/TestResults/summary-tests.trx`，不上传金融数据或构建输出。测试全部为临时目录中的合成内容。

实际 Controls API 编译：从 `bf75d563a325fa257c9097740dbcd0caa2e0b000` 只导出自研 Controls、Contracts 及构建设置到 `/tmp/caiwu-summary-controls-bf75d563`；不改其源码，不提交这些副本。

```sh
tools/dotnet-local.sh build tests/Caiwu.Summaries.Tests/ControlsAdapterSmoke/ControlsAdapterSmoke.csproj -c Release -p:TreatWarningsAsErrors=true -p:CaiwuControlsProject=/tmp/caiwu-summary-controls-bf75d563/src/Caiwu.Desktop.Controls/Caiwu.Desktop.Controls.csproj
```

结果：`net10.0-windows` 桥接项目 **0 warnings / 0 errors**。没有实际运行 WPF 窗口；此结果只证明指定 DTO 与 PickSummary 签名能组合编译。

首次测试中一个缺文件断言把缺父目录错误错误地限定为 FileNotFoundException，已修为 IOException 族；服务一直未创建缺失库。后加并发用例触发 xUnit1051，已显式传入测试取消令牌。最终结果如上，不把这两次失败计作通过。

## 主集成最小步骤与剩余项

1. 将本分支唯一功能提交合入开发分支，或 cherry-pick 最终报告的不可变 SHA。添加摘要项目/测试到主 solution 与 CI，并给 Desktop 增加摘要项目引用；这些路径不属于本任务，未改。
2. 宿主登记 `(BookId, CatalogPath)`，明确新建与打开的区别；按 README 的 adapter 接 `PickSummary`，仅 Accepted 时改摘要框。需要 Controls `bf75d563` 或兼容 API；默认不捆绑其分支。
3. Delivery owner 按 README 增加独立 JSON 附件登记及整体备份收据；现有 `.caiwu` inventory 只登记 SQLite，不能把 JSON 冒充数据库。租约、数据根保留与升级门控继续生效。
4. 在 Windows 实际验证宿主按钮/双击、取消保持原分录、错误提示、两个管理窗口冲突、切账套与备份登记。Linux 交叉编译与本模块测试不代表 Desktop 已接线或完成 Windows 实机验收。

没有发现阻止本独立模块编译/测试的剩余问题。宿主接线、Delivery 登记与 Windows 运行验收尚未完成；它们是对应 owner 的集成任务，本分支没有占位实现或解除交付保护。没有安装器发布、原包分析/上传、main 合并、权限修改或新凭据。
