# 真实桌面接线：当前验证与交接

当前生产及探针代码提交为 **bfc50481fc75c20da254f8daade9b25fdf076666**，私有分支 codex/desktop-feature-wiring，草稿 PR25。当前入口已经实际接入 App/MainWindow，不再只提供初始化说明。接线及六个固定模块 SHA 见 src/Caiwu.Desktop/Features/HOST_INTEGRATION.md；受管数据 owner 的精确接口见 MANAGED_MODULE_API_REQUEST.md。

## 已完成的实际路径

- App 先真实首次设置/显式登录，再构造固定 OperatorSession 的 AuthorizedLedgerService backend 和主窗口；取消登录没有可写会话。顶栏不能任填姓名，系统菜单可管理操作员、本人改密、注销换人。没有生产默认密码或跳过认证开关。
- 新草稿复制从原显示 Snapshot/选中凭证捕获计划，进入宿主编辑工作区，只有显式保存写账。服务使用可信 ActorKey 和原 token；错误/冲突保留输入，成功不重复保存。
- 摘要真实管理窗口和 BookTools 真实窗口调用均已完成薄适配，缺少安全宿主配置时默认禁用；没有用空委托假装具备租约或附件登记。
- 成本工作表可从真实宿主打开，仅审核建议，没有记账回调。民非制度另有真实分类/两表预览入口，JSON 明确标记仅本地预览、未进入受管附件或备份。
- 原账套会话与原登录共同绑定窗口；切账、同 BookId 恢复、注销/角色/密码失效后旧服务不能写入。后台任务结束前禁止关闭主窗或换账/换人，避免发布后登记尚未结束时退出。

## 本轮实际执行的检查

在 Linux / SDK 10.0.402 / runtime 10.0.13 上，validate-combination.sh 从当前代码及六个固定作者 SHA 创建独立临时 checkout。Desktop 项目引用及 App 接线使用已提交源码，不再由脚本打临时入口补丁。

| 检查 | 结果 | 证据目录 authenticated-bfc5048 |
| --- | --- | --- |
| Desktop 完整组合 Release 编译，warnings as errors | 0 警告 / 0 错误 | desktop-build.log |
| 完整 Caiwu.slnx 编译，含既有 Wpf 验证宿主 | 0 警告 / 0 错误 | solution-build.log |
| 真实 SQLite/摘要/身份文件及实际 Features 源码 | 16 场景通过 / 0 失败 | logic.json、logic.log |
| 新功能 Windows 宿主交叉编译 | 0 警告 / 0 错误 | windows-cross-build.log |
| VisualReview / UiNavigation / NativeFocus / HighResolution / MutationWindows / DualWindows | 各 0 警告 / 0 错误 | 对应项目日志 |
| 所有 Windows 实际运行 | **未执行** | 当前环境无 Windows/WPF runtime |

16 个服务场景检查原 token、不隐含保存、新 Draft 身份/状态与单次保存、错误更正重试、同身份恢复/重开、外部 SQLite 并发、摘要原 ID/版本/输入保留、取消无写入，以及缺认证/原始未包装服务拒绝、Reader 不能保存、注销后新登录不能复活旧窗口。它们比较真实持久化数据，不以数量代替窗口功能验收。

manifest.json 记录源码提交、基线、六模块 SHA、生产/探针文件 SHA256 和全部日志 SHA256。早期 evidence/*1192434* 是旧阶段的不可变证据，只证明当时 13 个无新组合身份要求的服务场景，不得代替当前认证接线验证。早期并发启动两个共享输出 build 曾造成 GenerateDepsFile 文件占用，后续全部顺序执行，未删除测试或放宽检查。

## Windows 下一步

运行：

    pwsh -File tests/Caiwu.Desktop.FeatureTests/Windows/run.ps1

脚本有 90 秒 watchdog，含 14 个真实窗口场景：首次设置取消、设置成功后取消登录、随后显式登录并显示锁定顶栏；菜单/缺配置门槛；复制取消、错误留窗、更正保存与主题；同身份旧窗口；摘要后台 I/O 与 Dispatcher 状态通知、持久化/冲突/无效 Unicode；摘要恢复失效；成本建议不记账；BookTools 真窗口取消/明确确认且保留源会话；无认证全入口禁用；民非制度门槛及缺分类/未保护标记；注销后旧草稿保留且新登录不能复活旧操作。

这是正常虚构身份登录注入的独立测试宿主，测试密码和夹具不编入发行程序。既有渲染、导航、原生键盘焦点、金额、旧窗口、双进程脚本也已适配真实登录，原断言保留；它们仍须在 Windows 上重新实际运行。旧 b3b85eb 的通过结果或截图不能算作本次新认证组合的验收。Routed Button.Click/渲染 PNG 不能代替物理键盘/IME、多 DPI 或原生屏幕测试。

## 精确未完清单

1. **pending owner**：codex/managed-module-data 的真实 Delivery scope。目标为 BookCopyFeatureOptions 的 AcquireDataLease、ValidateManagedDestination、RegisterCreatedBook，以及摘要 OpenSummaryCatalog/附件目录和整体备份恢复登记。当前 public 安装锁不足以代替数据锁，不能复刻 internal 协议或放宽升级保护；App 两个菜单保持禁用。全局 Operators 身份库不能作为某一本账套附件恢复。
2. **pending Windows**：实际 App 首次设置/登录、14 个窗口场景、既有焦点/金额/导航/双进程、BookTools Windows 并发发布与真实租约验收。当前只交叉编译，未声称已在 Windows 启动或可用于真实生产账务。
3. **pending packaging owner**：packaging/build.ps1 仍调用产品 --smoke-test。产品现拒绝该旧开关并 exit 2；Verification/** 不进发行程序集。应改为独立认证测试宿主，不能恢复跳过认证后门。打包/升级暂停保护未改，未生成安装包。
4. **not integrated**：Designer 03ee6da。下一阶段需模板用户路径、版本和受管备份配置；本阶段没有占位页面或任意默认保存目录，不拖延四功能与身份主路径。
5. 成本作者页面大工作表计算/导入导出延迟尚未量测；民非分类 JSON 尚未登记备份，当前只可按明确标记另行保管。没有自动记账、猜分类或补零。

本阶段没有当前权限拒绝或不确定的远端推送。未修改主 XAML/Themes、Contracts/Core/Storage、预挂载书库、原安装包或派生 catalog；所有运行数据均为合成账套及虚构临时身份。
