# 独立 Windows 模块 UI 验收交接

后续 root 已明确授权并完成 BookTools 工作区小修：生产修复 `49b194e`、实际 Windows 验收 `083727a`，1024×768 与 1920×1080 下底部原生鼠标可达已通过。详见 [WORKAREA_FIX.md](WORKAREA_FIX.md)。以下为 11:21 第一阶段的原始交接与当时未完项，保留为历史证据。

2026-10-25 UTC；私有分支 `codex/module-copy-summary-qa`；草稿 [PR 29](https://github.com/xhc144/caiwu-suite/pull/29)，目标 `codex/sprint-integration-2`。

**success：实际 WPF 控件/服务用例、30 轮 Windows 同目标发布竞争及逐用例截图收据检查全部通过；partial：小屏幕原生窗口适配未通过视觉复核，详见下方剩余项。** 真实 Windows 验收源码 SHA：`e83aa9ab0ea16975b718f3ff21e34c8e4941b4d7`；[最终聚焦 CI 40188069024](https://github.com/xhc144/caiwu-suite/actions/runs/40188069024)，三个 job 均 success。后续仅保存证据/文档的提交不冒充新的运行源码 SHA。

原始最终产物：[Voucher artifact 12596486985](https://github.com/xhc144/caiwu-suite/actions/runs/40188069024/artifacts/12596486985)、[Summary artifact 12597031967](https://github.com/xhc144/caiwu-suite/actions/runs/40188069024/artifacts/12597031967)、[BookTools artifact 12597067046](https://github.com/xhc144/caiwu-suite/actions/runs/40188069024/artifacts/12597067046)。23 张原始 PNG、JSON 与日志另存 `evidence/windows-e83aa9a/`，避免仅依赖 14 天 CI 保留期。压缩包 SHA256、每个模块文件清单和每张补验收据均已在本机重新计算匹配；完整 run 结果与 archive 元数据亦随证据保存。

## 实际行为范围

- Voucher：复用作者 12 个真实模态窗口探针，输入解析/错误留窗/修正后确认/取消/路由 Escape/只返回新草稿计划/原快照 token/重复确认保护；补验实际键盘焦点、真实 Core+SQLite 显式保存及过期计划拒绝，失败不覆盖并发胜者。
- Summary：实际分类与摘要管理控件、JSON 保存重开、取消不写、独立服务版本冲突留输入、Windows 无 Delete 共享句柄导致的真实替换失败和释放后重试、恢复焦点、损坏输入及账套隔离。补验 D800/DC00 两种坏查询在真实 TextBox/DataGrid/ChooseButton 上清旧选择、拒绝旧摘要，恢复查询必须显式重选，原 JSON 字节保持不变。
- BookTools：实际窗口的非法输入留窗、预览无写、明确勾选确认、输入变更撤销确认、取消不发布、执行中安全取消、源快照变化拒绝并留输入；全量与仅科目期初均重开 SQLite 验证。样本经真实 Core 制单/独立审核/记账/结账到 1 月；全量保留结账 1 月及银行 10.20，仅科目期初重置结账 0 月且银行 10.00，原始期初均为 10.00。新身份、字段、凭证/审计范围及源哈希检查均为实际断言。
- Windows 并发：30 轮，两个独立 BookCopyService、不同合成源、同一目标，在最后一次目标检查后用 Barrier 同步放行。要求每轮恰有一个成功者，失败者 IOException，最终 BookId/文件哈希等于成功者，失败方清理完成后成功目标仍在，两源字节哈希不变、临时目录清理。完整每轮结果保存在 `book-race.json` / `race-observations.json`。

这不是全项目验收，也不是仅凭编译或检查数量宣布模块业务完工。未运行完整 Core/Storage 套件、安装、升级、主 Desktop 菜单或宿主认证组合；上述行为均调用真实现有模块/服务。

## 证据与修正依据

原始 PNG/JSON/日志按运行源码 SHA 保存；每个模块 `evidence-manifest.json` 包含实际 checkout SHA、相关 Git 子树、每个原始文件 SHA256/长度。补验每张 PNG 自带原生尺寸、DPI、机制和哈希收据。收尾时在本机逐个重算；不编辑图片、裁剪、放大或修改原始 JSON。Windows 原始 CRLF 保持不变；证据目录局部 `.gitattributes` 禁止文本换行转换，避免后续 Windows/Linux checkout 改坏收据。

1. 原作者 Summary smoke 在 `b65bd19` 的首个归属显示断言失败，[原 run](https://github.com/xhc144/caiwu-suite/actions/runs/40187041374)。`c18b6e8` 原样断言加诊断复现，[诊断 run](https://github.com/xhc144/caiwu-suite/actions/runs/40187210617)：BookId 与注入一致，`TextBlock.Text` 为空，而 `TextRange` 和原始截图完整包含正确账套名/ID。`evidence/diagnostic-c18b6e8/` 保留失败 JSON、日志及截图。
2. `de723e4` 只修测试读取方式为实际 inline 文本；账套 ID 与显示名预期不变，没有为了通过测试修改生产 WPF。该轮 [CI](https://github.com/xhc144/caiwu-suite/actions/runs/40187319742) 三组均通过。原 Voucher 探针源码仍与作者 `54871a0` 完全相同。
3. 初期 PrintWindow 有前一帧/部分页脚的图像，后续加入消息泵等待，并在 `0f44199` 增加完整前台桌面 BitBlt、取消完成状态的可见性及坐标记录。`e83aa9a` 再对齐仓库已验证采集路径的 dispatcher 排空与独立渲染线程等待。最终原图实际显示预览和取消状态；个别 PrintWindow 字段仍可能少于桌面帧内容，应结合两种原图读取，不能把图像完整性收据当作逐像素视觉通过。
4. 人工逐用例收据检查发现两项凭证补验复用一个 PNG 名称。`1837455` 改成各自文件名，原生输出一律 CreateNew，并在所有用例结束后逐张复核收据哈希；旧轮次的功能通过结论不替代最终逐用例截图完整性结果。

本轮没有生产源码修复 SHA，没有 Core/Storage/Contracts/主窗口修改。测试修正及证据补强均限分配目录。除下述小屏幕窗口越界外，没有发现需越过 ownership 修复的生产逻辑缺陷。

## 基线和集成

起点 `10e38ff65313aae5106a6b55c42790d47345b8fb`。已通过目录 diff 确认指定 Voucher `54871a0`、Summary `dcda051`、BookTools `8bbf842`、Storage create `4e8664d` 的生产源码已按不同提交 SHA 包含，没有重复拣选。现代主题与 `98a43e0` 的 `src/Caiwu.Desktop/Themes` 完全同树 `72ad713d1368a3b6cb78d094dc52fc7b328277fc`；补验通过独立 Application 加载实际生产 Modern.xaml BAML，不启动产品登录生命周期。收尾已 fetch 最新集成 `8cf5d4335af7c06a10252cecae959446b5d40d2b`，上述模块、Contracts/Core/Storage/主题目录与本次验收来源仍无 diff；PR 为 mergeable 的 draft。

root 可在兼容集成基线上依次拣选本分支自 `10e38ff` 之后的 QA 提交；PR 仅包含 `tests/Caiwu.ModuleWindowsQA/CopySummaryBook/**` 和唯一 `.github/workflows/module-copy-summary-qa.yml`。不需要 solution、Contracts 或宿主入口变更。若未来生产子树改变，本次证据不能认证变化后的代码。

```powershell
./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module Voucher
./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module Summary
./tests/Caiwu.ModuleWindowsQA/CopySummaryBook/run.ps1 -Module BookTools
```

每次需全新输出目录，源码必须已提交。workflow 仅匹配 QA 分支，三组独立上传，不依赖全局/安装任务。任何模态或进程超时均失败，无 skip/pass 替代。

## 文件用途

| 文件 | 用途与证据 | 置信度 |
| --- | --- | --- |
| AuthorVoucher/* | 作者实际模态 WPF smoke、现有合成样本、相对引用适配的原 runner | high |
| AuthorSummary/* | 作者真实 JSON/WPF smoke，保留原预期并修复 inline 取值，失败诊断可回放 | high |
| BookTools/Program.cs | 9 个补验场景、真实 SQLite 样本、30 轮 Windows 发布竞争 | high |
| BookTools/NativeCapture.cs | 原生 HWND PrintWindow、前台完整桌面 BitBlt、尺寸/DPI/哈希收据、拒绝覆盖 | high |
| run.ps1 | 受限进程、失败不阻止独立补验、收据完整性检查、源码 SHA 文件清单 | high |
| .github/workflows/module-copy-summary-qa.yml | 唯一分支专用 Windows job matrix 和即时 artifact 上传 | high |

## 剩余范围

- 输入通过实际 WPF 控件属性与 Click/Key RoutedEvent 驱动；键盘焦点为实际 IsKeyboardFocused 检查。原生鼠标、物理键盘、IME、屏幕阅读器、多 DPI/屏幕尺寸适配仍未验，不能从这些结果外推。
- **partial / 小屏幕视觉门槛未关闭**：实际 1024×768 runner 中 BookCopyWindow 默认 790×740，CenterOwner 在无 owner 的独立宿主可将窗口置于工作区外，底部确认/关闭控件可能被任务栏或屏幕边界挡住。目标是 BookCopyWindow 的小屏幕实际命中验收；未因权限被拒绝、没有未知执行结果。已完成控件/服务行为和完整 HWND/原生桌面截图，未完成小屏幕物理点击。最小建议交 root/模块 UI owner：在实际 owner 所在显示器工作区内限制尺寸与位置，并让输入/预览在剩余高度可滚动；勿改 Core/Storage 或用测试调整断言遮盖。可直接查看 `BookTools/book-full-preview-desktop.png` 与同名完整窗口原图对照。
- 宿主 feature owner 和候选安装 owner 负责最终入口、认证/租约、摘要备份附件登记、安装更新保留账套与整体候选组合。本分支没有解除已有交付暂停标记，没有生成分发包。
- 不读取或修改预挂载书库，不运行/上传原商业软件或其新派生资料，不建立真实账户，不生成凭据，不更改仓库私有性/权限，不合 main。
