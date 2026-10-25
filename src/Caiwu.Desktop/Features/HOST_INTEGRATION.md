# 实际桌面接线与交接

本分支已经实施 App 登录组合、Desktop 项目引用、MainWindow 初始化/身份菜单、四功能薄适配和民非预览。主 XAML/Themes、Contracts/Core/Storage、安装保护和仓库权限未改。生产接线所有权由根在本轮明确移交；没有另造插件框架或身份实现。

## 集成顺序

根先采用以下作者源码，再拣选本分支提交。Desktop 已有六个 ProjectReference，MainWindow 构造函数已自动调用 InitializeDesktopFeatures；不要再加第二处初始化。

| 模块 | 固定源码 SHA |
| --- | --- |
| VoucherTools/WPF | 54871a004a836d76824b2c29959e5b22139f4e86 |
| Summaries | dcda051a0c9ee364ccff4c2b4c7085f446fac39d |
| BookTools/WPF，含并发发布 P1 修复 | 8bbf8428ccd0b656fec83c7a1ede828cd5691442 |
| Costing/WPF | af0d0e34ab9963fc91cabb8a58aed558b34390f0 |
| Operators/WPF，含集中授权适配 | 1957435365390756fd8267937fd0ec408b1e498f |
| Nonprofit.Reporting/WPF | cb71350b2b19067e7a8704b74985d8cf0f15e1aa |

Costing 若已有 398ed4a，只补 1d0ff00、af0d0e3。BookTools 必须保留 86a10e6→eb8f150→8bbf842 的修复结果，不能用旧发布代码。模块源码由其 owner 提交，本分支不重写它们。现有 solution 可经 ProjectReference 构建；根收齐模块后可由 root owner 把独立模块/测试加入 solution。

实际读取的集成基线为 5e21ac3，后续核对 b3b85eb 的 MainWindow/session 接口未变：_session、_displayOrigin、_voucherOrigin、Snapshot、VoucherGrid、VoucherListRow.Value。主窗口行为改动和 partial 已在固定模块组合里实际编译。

## 生产登录与会话

App 使用 LocalApplicationData/CaiwuSuite/Operators 的 FileOperatorStore/LocalOperatorService，位于安装目录之外。首次设置管理员后仍须显式登录；取消时不创建 backend、MainWindow 或可写账套会话。没有生产默认密码、任意身份输入或跳过认证参数。

App.CreateAuthenticatedBackend(operators, fixedLogin) 是真实组合 API：Open 检查 ReadLedger；Create/Restore 检查 RestoreLedger，继续调用原 LedgerFilePolicy 和 Storage 不覆盖规则。AuthorizedLedgerServiceFactory.BindSession 把九个写入口、三个查询集中绑定到该次 OperatorSession；原 Core 只存在于 trustedFactory 闭包，UI 仅拿包装服务。Backup 额外检查 BackupLedger 和原显示会话，不在身份锁内弹窗。

MainWindow(backend, authentication, featureOptions) 自动接线。authentication 缺失时不创建 LedgerSession，四个新业务入口全部禁用并说明原因。顶栏在行为代码中锁定为登录 DisplayName；OperatorName() 返回可信 ActorKey，不读取 ComboBox.Text。系统管理已接真实操作员管理、本人改密、注销换人窗口。管理员没有隐式账务特权，应创建/分配实际制单、审核等角色。

注销/换人先撤销精确的旧 OperatorSession，再关闭 LedgerSession 增加 generation，随后关闭主窗；App 创建新的登录、backend、主窗。取消新登录保持未登录。角色/密码变化、注销或过期使旧服务失败；不会在保存瞬间取全局新登录者。原账号目录与单本账套附件分开，恢复一本账套不能覆盖全局身份库。旧自由姓名不自动映射或重写。

新功能捕获 FeatureSessionBinding：原显示 Snapshot、physical path、generation、原服务、FeatureAuthentication。后台权限检查与最终集中授权都使用同一登录对象；不在 UI 线程轮询身份文件，不以新 GetSnapshot 替换待提交 token。

## 四功能行为

“实务操作”增加复制凭证、成本工作表；“会计档案”增加常用摘要管理、复制账套。

- 复制凭证使用作者真实 VoucherCopyWindow，当前可信 ActorKey 不可编辑。确认计划后进入宿主可编辑的新 Draft 工作区，只有“保存新草稿”写账。Id=null，原 ExpectedBookId/ExpectedRevision 保留；新制单身份来自集中装饰器，不继承审核/记账身份。错误和冲突保留输入；成功先消费计划再刷新，刷新失败明确区分已经保存。取消无写入，保存期间不能关闭。
- 摘要复用作者 SummaryManagerState。AsyncSummaryStateAdapter 仅把 catalog I/O 放 worker，所有状态机转换和属性通知回 UI context；保留开始编辑的 ID/CatalogVersion，搜索清除当前选择也不改变编辑对象。缺少真实 catalog/备份附件配置时禁用，打开失败不会自动创建空库。注册可明确 ManagementPermission，默认 PrepareVoucher。
- 账套复制直接调用 8bbf842 的 BookCopyWindow/BookCopyService，固定原快照、不临时刷新。必须提供真实数据租约、受管新目标策略和新账套登记，额外检查 RestoreLedger；源/捕获副本调用 LedgerFilePolicy。操作人字段锁为宿主 actor。成功默认保留源会话；文件已发布但登记失败时保留新文件并报告路径，不能删除或盲目重试。
- 成本直接承载 CostWorksheetPage(bookId, date)，只生成计算/人工审核建议，没有 ledger 保存或记账回调。作者页面大工作表计算/导入导出延迟尚未量测，不承诺任意规模都无卡顿。

会话切换、关闭、同 BookId 恢复/重新打开或来源刷新后，旧窗口禁用并保留可见输入。原服务最终授权与 Core CAS 仍在保存时复验，不用 UI 菜单状态代替服务保护。

## 受管数据门槛

App 当前未配置 OpenSummaryCatalog / BookCopy，两个菜单保留明确 disabled reason。根已另行委派 codex/managed-module-data；本任务不建立第二套登记或备份协议，也不等待其预计 11:30 交付而越过本阶段 11:00 截止。

精确委托、租约生命期、physical path + BookId 映射、摘要独立收据和恢复要求见 MANAGED_MODULE_API_REQUEST.md。当前 public Installation.AcquireLease 只有安装锁，完整 WithExclusiveData 还是 internal；不能把安装锁当数据锁，不能往仅接受 .caiwu 的 managed-books 清单塞 JSON。

## 民非预览

“报表”菜单已有真实 NonprofitClassificationPanel，仅民非制度启用。期间取当前凭证查询中明确的完整同一月份；不支持的日期范围会报错，不猜分类、限制维度或缺失金额。App 显式给出 LocalApplicationData/CaiwuSuite/LocalPreviews/Nonprofit，再按 physical path + BookId 分隔；模块继续校验安装目录、路径和源指纹。

宿主和面板持续显示“仅本地预览，分类 JSON 未纳入受管附件/账套备份”。分类可另存新文件、来源改变会失效；未完成 Delivery 登记前不能改称已保护。Designer 尚未接入，不等待它。

## 测试宿主与发行边界

Verification/** 已从生产程序集排除；产品拒绝旧 --smoke-test 并以 exit 2 结束。packaging/build.ps1 的旧调用须由 packaging owner 换成独立测试宿主，不能恢复产品认证后门。其余打包暂停保护未改，未生成安装包。

Shared/SyntheticDesktopIdentity.cs 只在独立测试工程编译，正常创建虚构身份、登录并调用真实组合 API；密码仅为该临时测试身份使用。VisualReview、NativeFocus、HighResolution、MutationWindows、DualWindows、Wpf、导航宿主均已适配，保留原焦点、金额、原 token、数据不变和输入保留断言。双进程共享虚构身份目录但各自正常登录。

Windows/run.ps1 包含真实首次设置取消/设置后取消登录/显式登录、新功能模态窗口、主题、后台 I/O、旧登录/账套失效、民非缺维度及未保护标记。Routed Button.Click 与实际 WPF PNG 不等同物理键盘/IME、多 DPI 或原生屏幕验收。本环境为 Linux，Windows 执行未跑；编译不能代替这些结果。validate-combination.sh 可重建固定六模块组合并运行合成服务检查、编译现有测试宿主；实际结果与源码哈希见测试目录 VALIDATION.md/evidence。
