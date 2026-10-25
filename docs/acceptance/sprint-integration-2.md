# 第二阶段主集成与 Windows 验证

更新时间：2026-10-25 10:49 UTC。私有分支 `codex/sprint-integration-2`，目标 `codex/windows-revalidation`，草稿 [PR16](https://github.com/xhc144/caiwu-suite/pull/16)。本阶段最迟 **11:00 UTC** 交接结束。交付暂停标记和安装/升级账套保护保留；没有新安装包、分发 ZIP、main 合并或权限修改。

**核心与现代视觉的完整 Windows 组合已通过**：代码 `1f4e9ea14aad44de3a2c6673811808260ee43922`，成功 [run40184804270](https://github.com/xhc144/caiwu-suite/actions/runs/40184804270)。认证/功能宿主生产代码为 `74fc20d6029f4626554356aff002d6cd18c8037b`；该组合独立测试启动遇到实际Windows阻断，测试隔离修复 `1f2fd4f4eba7ee25f64c359b8ee9353358e19f32`（生产树未变）的[完整run40186288355](https://github.com/xhc144/caiwu-suite/actions/runs/40186288355)与[定点run40186288268](https://github.com/xhc144/caiwu-suite/actions/runs/40186288268)正在验证；不能用前一组合绿灯替代新认证路径结果。

## 已接入来源

| 来源 | 本分支接入及边界 |
| --- | --- |
| 原阶段 `6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5` | 实际远端基线，已含 fa463b7、Core v1.2 原快照/非空新草稿 token、会话代次、Preview 完整转发、App 文件门槛、导航保留 |
| Contracts bb76658、Core6662120、Storageecc5225、Deliveryef17e64、Controls633cfb9+bf75d56、独审49de1be、导航0f8fb850 | 基线已包含，比较生产目录/关键 blob 后避免重复拣选 |
| 现代视觉79f7665→87b7773→9b544ed→33985eb；7a845d4/88325ed/de804ac | 按作者提交/最终 blob 导入；旧证据保留，不冒称为最新图 |
| 最新核心视觉 a423aba→2586fed12b14e0659f83c5849dc1f848ddc0d06c | 9879859、a74d03f；Fluent Light 日期/下拉、正文中性字重、报表金额分组/对齐。原期初 PropertyChanged 与 Report BackButton/Back_Click 保留 |
| Delivery d6f92dcd9361260eb5a6eced7fc4909fa914311e / PR18 | 059cae6；关闭的一致性副本取 hash，报告/文件同一快照，不放宽 payload 共享保护 |
| Storage 4e8664d5db711b6fe8543a1bf3c689f3f39c2a30 / PR23 | 3f844de；Unix link 原子拒绝覆盖，Windows 不覆盖 Move；失败只清自身暂存，保留深读回/CAS |
| Storage 测试549b4e6f90f1a62df6e34ad2a84a2c0f67c6cf02 / PR26 | 86342a1；DELETE-journal 合成夹具关闭连接后比较原字节，原回滚断言保留，另加等长修改敏感反例；未改生产共享 |
| Voucher54871a0、Summarydcda051、Book8bbf842、Costaf0d0e3、Operators1957435、Nonprofitcb71350 | 83f230c 按作者精确源目录导入；Book 含发布竞态修复，禁止退回86a10e6/eb8f150旧实现 |
| Feature f202884→1192434→002eb07→11b636a→5de9a53→ecd977f→bfc5048→1a50488 / PR25 | 7fd01c1..39fa5ed；实际 App 首次设置/登录、固定身份集中授权、真实 MainWindow 菜单和模块窗口；没有覆盖最新视觉文件 |
| 本阶段行为探针/CI | 原生 SendInput 焦点、六项旧窗口隔离、真实唯一 OK 控件定位、Windows 发布竞争、完整 source-bound 检查；74fc20d 将认证测试移至独立宿主并把模块纳入 Release solution |

Delivery `BookInspection.FileSha256Basis` 区分输入 `sqlite-consistent-copy` 和输出 `database-file`，不能拿活跃 WAL 主文件原字节与前者比对。Core/Contracts 无本阶段自行修改；Storage/Delivery 生产修改来自对应 owner。未动预挂载书库、原软件字节、真实原窗口/SQL/对象目录或新派生 catalog。

## 完整 Windows 核心组合实际结果

以下全部属于 **1f4e9ea / run40184804270**。实际 Windows10.0.26100，SDK10.0.402/runtime10.0.13，合成账套。各口径不能相加作功能完成数。

| 实际检查 | 结果与行为 |
| --- | --- |
| Core / SQLite / Reporting / Reporting集成 / Controls | 149 / 117 / 45 / 9 / 15 全部通过；原45项Readback夹具失败逐项恢复，未跳过 |
| SQLite 原竞态复验 | 原入口12/12通过；全量含线程/双进程Create、Backup、Restore、晚到目标与失败清理7项；不覆盖目标 |
| Delivery | 143通过、0失败、4明确跳过；六项共享/WAL/失败保留通过；不把跳过算通过 |
| WPF实际输入、错误、忙锁、重复保存、只读 | 8项通过，失败保留原 token 和输入 |
| 新建取消、报表联查/返回 | 2项通过，查询/选择/双向滚动保留，账套/audit/revision不变 |
| 旧期初/科目/删除/审核/记账及同BookId+Revision恢复 | 6项通过；旧服务/窗口失效，输入保留，无静默刷新重试 |
| 原生F4搜索/取消/接受后的继续键入 | 2项通过；真实SendInput，取消回原摘要格，接受后借方输入42.75；96DPI，未验物理键盘/IME |
| 两个实际WPF进程与App Open/Restore文件门槛 | 3项通过；同账套旧编辑拒绝、异账套不串账，文件政策先于Storage |
| v1.2独立真实SQLite/session/Preview | 22项通过 |
| 现代资源与实际窗口 | 10项检查、6张原生窗口图通过；正文真实CJK字体为YaHei UI，原生日期/下拉模板保留 |
| 四主页面高清 | 主界面、凭证、账簿、报表均1920×1080、96DPI、原生BitBlt，未裁剪拉伸 |
| 源码身份、暂停/无分发包门槛 | 全通过；没有放宽source guard或删除暂停标记 |

原失败证据保留：Unix旧Create两个调用均成功，12轮10失败；Storage旧Windows45项在夹具File.ReadAllBytes共享处失败；四个旧窗口timeout由探针硬查ID1导致，实际唯一OK按钮ID2。修复按对应owner/探针提交闭合，不以偶尔重跑绿灯关闭。

旧RID publish会改写四个tracked packages.lock.json，故source guard正确阻断。原始差异见证据目录rid-restore-lock-mutation.patch，仅诊断不应用。1f4e9ea暂停路径避免RID publish后从洁净checkout完整通过。认证宿主现拒绝产品--smoke-test，74fc20d改为独立真实虚构身份登录宿主；没有生产默认密码或跳过认证开关。旧windows-readback-fixture-suggestion.patch已被549b4e6取代，不应用。

## 新认证/模块组合状态

74fc20d已在Linux完整Release编译，0warning/0error；真实SQLite/摘要/身份文件16场景通过；新14项窗口宿主交叉编译通过。生产App真实首次设置与显式登录，取消无可写会话；固定OperatorSession贯穿原服务与新窗口，不能在保存时取新全局登录。复制凭证仅显式保存新Draft写账，成本仅计算建议；民非预览明确标记JSON尚未受管保护。旧定点run40185768596实际失败：六旧窗口全部35秒watchdog阻断，焦点输入未到格后Application关闭，视觉90秒timeout。artifact12595763828保留失败。所有宿主直接new App触发产品新增登录生命周期；1f2fd4f仅在独立测试程序集派生资源Application，隔离重复产品启动，正常虚构身份登录/集中授权和原断言保留。真实首次设置/登录对话框及组合API仍由14项场景检查；独立资源宿主不等同产品启动事件本身已验。旧全量40185768858已请求停止，新Windows结果待40186288355/40186288268，不把模块库测试或交叉编译当应用完成。

**摘要管理与账套复制目前在App中仍禁用**，因为实际受管路径/附件登记/数据租约委托尚未接入。Delivery受管模块实现9ca1deb/evidence795f6d6已交PR28，但未接入本阶段；需Feature owner按其真实API接线，不得用空委托开启。ReportDesigner尚未接入。详细接口、六模块完整SHA与生命周期见src/Caiwu.Desktop/Features/HOST_INTEGRATION.md和MANAGED_MODULE_API_REQUEST.md。

## 可交根的证据

- 本组合主四图及全部结果：artifact **12595726977**，ZIP SHA256 `613018f0ac76a04491fe4a1358ba9ed6d97898b2d7601c1d1e788feb576022b5`，源码 **1f4e9ea14aad44de3a2c6673811808260ee43922**。完整结果JSON已保存本仓库证据目录，PNG留在Actions artifact，无需再上传二进制。
- 最新视觉作者独立图：2586fed，run40182847550，主四图artifact12595156632，SHA256 `94d69b69471ea56821d9bd7a0e9df1e1003cab87573fce9b9cc114ab2c86d7b8`。核心视觉已由根确认改善；不是后续模块窗口验收。
- 最新视觉+旧窗口/焦点定点：a74d03f，run40183498471，artifact12595187759，SHA256 `979eebbc7269bdc9fe7297b84c54e73d27dd3e36eb68080926f36998ec087d8c`。
- 历史失败/修复分界、每张图hash见[evidence索引](evidence-sprint-integration-2/windows-artifacts-index.json)。旧图不冒指新源码。

## 剩余交接与边界

1. 完成1f2fd4f精确Windows组合并保存source-bound窗口结果；如失败，具体定位后交接，不拿1f绿灯覆盖。
2. Feature owner接PR28真实受管数据API，启用摘要/账套复制后另跑组合；全局Operators不能作为单本账套附件恢复。当前未改Delivery新实现或宿主委托范围。
3. 实际安装器/升级、NTFS断电/恢复、物理键盘/中文IME、多DPI/多显示器、打印尚未运行。当前ManagedDataContract/交付暂停仍阻止新发行包，不删除保护赶进度。
4. 成本大工作表延迟未量测，民非分类JSON和Designer备份未形成应用闭环，不称用户可用的完整财务套件。

没有待重试的权限拒绝或不确定远端写入。通过PR16审阅接到目标开发分支，先核远端最新头，不强推或覆盖他人分支。交接同时给验证代码SHA及最终文档SHA；文档提交不代表新代码另一次Windows运行。
