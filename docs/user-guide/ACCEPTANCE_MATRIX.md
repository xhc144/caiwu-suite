# 开发用功能验收矩阵

本表是截至 2026-10-25 11:39 UTC 的交付说明证据快照，不是整套软件完成声明。用户说明见 [安装与使用](INSTALL_AND_USE.zh-CN.md)。仅核对已共享自写源码、合成测试和 CI 结果，没有复制原安装包资源、原窗口、SQL、对象目录或派生 catalog。

## 核对基准与层级

本次文档分支基于主候选 `bd2e47a1afc480ba34796e64b2c454ebb024114f`。PR25 文档 head 为 `9ec65f84ee471dcda31378e8c49901d35f3a4220`，受管 Desktop 接线生产提交为 `e407e0b827c345ad2415ad0cb4634d0fc5f534a2`。新宿主的 Linux 合成行为证据来自 `68b7525127be34d13a7f382b9f0fa976fa574d95`，其中 Windows 标记明确为未执行；后续主题和部分窗口已变化，不能把它当当前候选 Windows 通过。

四个层级分别记录：**代码**（接口及非 Windows 行为证据）、**组件 Windows**（独立测试 Application）、**主宿主 Windows**（产品 App 与当前接线）、**已安装实际运行**（安装目录启动的产品）。后一层不会由前一层自动推得。表中的“通过”只指所列场景；“待验”没有被编译、脚本存在或检查数量代替。证据代号的源 SHA 与 CI 链接见后表。

## 按用户操作验收

| 功能与合成验收动作 | 代码 | 组件 Windows | 主宿主 Windows | 已安装实际运行 | 当前结论与收尾要求 |
| --- | --- | --- | --- | --- | --- |
| 安装、程序/数据分离、受管启动 | C：真实 EXE/回执校验、子进程持两租约；安装器快捷方式调用 `launch-managed` | W：已发布 helper 子进程保护通过，不运行 NSIS | 当前组合待验，不能用 B 代替 | P：较早安装候选登录及运行库加载有部分证据；I 待结果 | 核对最终快捷方式、父子进程转接、安装根外启动、实际 EXE/payload 来源和拒绝路径；不教用户手工改环境 |
| 首次管理员设置→显式登录→取消/错误密码 | C：设置不是登录，取消无可写会话 | O：真实窗口、显式登录、取消及重试通过 | 当前 App 首次设置/取消待验 | P：错误合成密码拒绝、正常登录通过；非完整闭环 | 在全新安装数据根验证首次设置后再次登录；无默认密码、无匿名测试开关 |
| 操作员管理、角色、改密/停用/注销 | C：固定会话授权，可信 Actor；登录名/显示名分离 | O：管理 UI、角色/密码失效及旧服务拒绝通过 | 当前 App 菜单/重新登录待验 | I 待验 | 验证管理员无隐式制单权、自审拒绝、旧编辑器保留输入并拒绝保存 |
| 新账套、科目与期初保存 | C：受管创建/打开登记；民非新建拒绝 | O：真实 Core/SQLite 期初；B：旧核心窗口基线 | B 有较早基线，当前组合待验 | I 待验 | 从实际新建对话框保存、关开核对科目及期初；验证根外/已有目标拒绝，记录 BookId/路径/revision |
| 草稿→另一身份审核→记账→账簿 | C：集中授权、原显示令牌及物理会话守卫 | O：真实 Core/SQLite 业务闭环；B：早期窗口与联查 | B 有旧基线，当前受管组合待验 | I 待验 | 实际登录切人、原生金额编辑、关开读回、余额与明细金额核对；已记账不可直接改删 |
| F4/F7/Ctrl+S/F10 | C：已逐处读 handler；F4 分科目查找/列表审核，F7 仅当前行平衡 | B 的旧原生焦点/金额探针不能覆盖新组合全部快捷键 | 当前上下文与焦点待验 | I 待验 | 分凭证表格、凭证列表、期初页、模态窗实际按键；补 IME 组合输入，不据菜单文字宣布通过 |
| 复制凭证→显式保存新草稿 | C/F：复制计划与原令牌，原身份不继承审核状态 | V：输入/取消、错误保留、真实 Core/SQLite 保存及陈旧计划拒绝通过 | 当前菜单→宿主新草稿窗口待验 | I 待验 | 对照原凭证未变、新 Draft 身份/日期/金额，取消无写；刷新失败时不能重复保存 |
| 常用摘要持久化与冲突 | C/F：真实异步管理器、首次确认创建、附件登记 | V：独立摘要窗口真实 JSON 往返、冲突、文件锁、坏查询拒旧选择通过 | 当前异步宿主与独立作者窗口不同，待验 | I 待验 | 验证当前管理器保存/取消/重新载入及坏库不重建；管理入口没有自动填入凭证的回调 |
| 复制账套两种范围及并发不覆盖 | C：作者核心源码匹配 V；F：新目标、租约及登记 | V：范围/余额/源不变/同目标竞争通过；V2 有小屏修复后新 CI | 当前受管登记与默认留在源账套待验 | I 待验 | C 尚未含 V2 工作区适配修复；先审 `49b194e…`，集成后在主宿主复验。附件不随结构化复制；不能称完整备份 |
| 成本工作表复算、尾差、保存登记 | C：独立计算与审核建议；F 有明确“保存并登记”按钮 | Q：真实编辑、JSON 复算、尾差、取消/错误清旧结果通过 | 当前菜单/权限/受管保存待验 | I 待验 | 复算合成 250→254 样本；确认保存登记后纳入完整备份，普通导出不自动登记；总账无自动写入 |
| 民非明确分类→两表预览 | C：已有实验民非账务只读；分类独立保存后登记 | Q：真实合成 SQLite、分类/导入导出、来源变化与旧结果清除通过 | 当前受管分类目录、月期间和关闭后登记待验 | I 待验 | 不开放民非新建、不宣称完整专有核算；缺维度保持缺失、账簿不变、登记失败文件保留 |
| 有限报表设计器 | C：当前页/期间/筛选快照；Q 的三项 WPF 修复已同树包含 | Q：列/公式/模板冲突/导出/失效/截断保护通过 | 当前菜单与受管模板登记待验 | I 待验 | 模板保存关闭后实际登记并完整恢复；CSV/HTML 在 Exports，不能混成附件；打印/PDF、其它 DPI 待验 |
| 完整备份及可信收据→新物理实例恢复 | C/F：SQLite+四类原生 codec，独立收据，原件保留；F 为 Linux 合成服务行为 | W：四类附件备份恢复与隔离通过；helper 不等于 F10 菜单 | 当前 F10、收据选择、恢复后正式打开待验 | I 待验 | 同 BookId 的新物理实例/目录独立；逐项核对附件和金额，源及全局身份哈希不变；未登记附件必须阻断 |
| 全局身份单独备份/恢复 | C：`ManagedIdentityBackup`，管理权限、含密码哈希、恢复到新目录 | W：独立身份边界组件通过 | 无主菜单入口，不能写成可点击完成 | 无已安装用户入口证据 | 管理员由受控支持流程单独处理，保留可信收据；不直接覆盖活动 Global/Operators，不把单本恢复当身份恢复 |
| 忙态升级、空闲升级、卸载保留 | C：保留门槛、规范 schema-v1 与备份副本保护 | W：真实 helper 跨进程忙态阻断、摘要升级备份及账套/摘要/全局目录保留通过 | 不适用组件结果不能替代安装流程 | I 待实际 NSIS 与产品闭环；P 失败未豁免 | 核对完整附件、全局身份、源/恢复副本及未知文件保留；未完成原地 schema 迁移或断电恢复，不删保护赶交付 |
| 私有自动更新 | C：默认关闭；检查/暂存/签名门槛存在 | 没有可信签名正向与真实 feed 闭环证据 | 未接成自动应用更新 | 未验 | 当前无可用 feed/下载凭据配置；不创建 token/服务，不称已自动更新，不把 hash 当发布者签名 |

## 固定来源与证据

| 代号 | 精确来源 / 实际运行证据 | 能支持的范围 |
| --- | --- | --- |
| C | 候选源 [`bd2e47a1afc480ba34796e64b2c454ebb024114f`](https://github.com/xhc144/caiwu-suite/tree/bd2e47a1afc480ba34796e64b2c454ebb024114f)；[PR25](https://github.com/xhc144/caiwu-suite/pull/25) 接线源 `e407e0b827c345ad2415ad0cb4634d0fc5f534a2`，handoff `9ec65f84ee471dcda31378e8c49901d35f3a4220`；Managed `9ca1deb40f9215817a0433572460183d3ba82566`；Designer `03ee6dac47a7cc1c61f303f3c5e214245f87017d` | 当前接口及实现，不能单独证明运行通过；本次未改产品代码 |
| F | 测试源 `68b7525127be34d13a7f382b9f0fa976fa574d95`；证据保存于后续 `9ec65f84ee471dcda31378e8c49901d35f3a4220` 的 [manifest](https://github.com/xhc144/caiwu-suite/blob/9ec65f84ee471dcda31378e8c49901d35f3a4220/tests/Caiwu.Desktop.FeatureTests/evidence/managed-68b7525/manifest.json)、[逐项合成服务结果](https://github.com/xhc144/caiwu-suite/blob/9ec65f84ee471dcda31378e8c49901d35f3a4220/tests/Caiwu.Desktop.FeatureTests/evidence/managed-68b7525/logic.json) | Linux 合成服务行为及交叉编译；`windowsExecuted=false`。当前候选存在后续主题/窗口变化 |
| B | 源 `1f4e9ea14aad44de3a2c6673811808260ee43922`，[Windows CI 40184804270](https://github.com/xhc144/caiwu-suite/actions/runs/40184804270)、[固定记录](https://github.com/xhc144/caiwu-suite/blob/8cf5d4335af7c06a10252cecae959446b5d40d2b/docs/acceptance/evidence-sprint-integration-2/full-windows-1f4e9ea.md)；认证定点测试源 `10e38ff65313aae5106a6b55c42790d47345b8fb`，[40186708406](https://github.com/xhc144/caiwu-suite/actions/runs/40186708406) | 已验证较早核心/焦点/视觉基线；不认证后续受管 App 组合或实际安装 |
| O | 测试源 `739b8dacda9187466a6c3907fe5d9de21ec714c7`，[Windows CI 40187405947](https://github.com/xhc144/caiwu-suite/actions/runs/40187405947)、[持久证据/范围](https://github.com/xhc144/caiwu-suite/blob/d7c43a063ee6dce5062bea04f73415319f07fc0b/tests/Caiwu.ModuleWindowsQA/Operators/HANDOFF.md)；生产 Operators `1957435365390756fd8267937fd0ec408b1e498f` | 独立 Application 的真实身份窗口、原生输入、授权 Core/SQLite 和会话失效。C 的 Operators/Core/Contracts 与该 QA 分支同树；产品 App 启动未在本组测试 |
| V | 测试源 `e83aa9ab0ea16975b718f3ff21e34c8e4941b4d7`，[Windows CI 40188069024](https://github.com/xhc144/caiwu-suite/actions/runs/40188069024)、[持久证据/范围](https://github.com/xhc144/caiwu-suite/blob/0650a7f35eb61a675996904191d7471699ba270e/tests/Caiwu.ModuleWindowsQA/CopySummaryBook/HANDOFF.md)；生产 Voucher `54871a004a836d76824b2c29959e5b22139f4e86`、Summary `dcda051a0c9ee364ccff4c2b4c7085f446fac39d`、BookTools `8bbf8428ccd0b656fec83c7a1ede828cd5691442` | 三组件真实控件/服务和 Windows 发布竞争；这些生产目录与 C 同树。旧小屏窗口有越界发现，不外推物理键鼠/IME |
| V2 | 修复 `49b194ee3fe86a514aade8c6808f160d219f9d8c`，测试源 `083727a0697182cd0831040f6298e42d92761089`，[Windows CI 40189370810](https://github.com/xhc144/caiwu-suite/actions/runs/40189370810)、[测试代码](https://github.com/xhc144/caiwu-suite/blob/083727a0697182cd0831040f6298e42d92761089/tests/Caiwu.ModuleWindowsQA/CopySummaryBook/BookTools/Program.cs) | 新 CI 三组件 job 成功，新增 1024×768/1920×1080 工作区及原生鼠标预览/确认/取消探针；尚未在本文 C 候选包含。本轮仅核对 CI 与测试代码，未独立目视该轮 PNG |
| Q | 测试源 `6db23d198b2215ec5a1e91fed0e3c62824ac2493`，[Windows CI 40188184523](https://github.com/xhc144/caiwu-suite/actions/runs/40188184523)、[持久证据/实际范围](https://github.com/xhc144/caiwu-suite/blob/801e145b9c33139ee8d9340445bb7e47dccc5e16/tests/Caiwu.ModuleWindowsQA/Financial/VALIDATION.md) | 三独立财务控件，有限原生输入/对话框及合成业务链。C 已含 `a2bd397d5aed2d722134d9474c95f186b99073ac`、`60756fca1f4f511eca6dcb64f5e2634881fd8da2`、`f6cb88538724d12580128683d1489186b35dc9de` 等效修复，三 WPF 目录与 Q 同树；不等于主宿主或打印验收 |
| W | 源同 C，[Windows 准备 CI 40189257984](https://github.com/xhc144/caiwu-suite/actions/runs/40189257984) 成功；运行定义 [`windows-candidate-validation.yml`](https://github.com/xhc144/caiwu-suite/blob/bd2e47a1afc480ba34796e64b2c454ebb024114f/.github/workflows/windows-candidate-validation.yml)。较早源 `6f56a678d8cd2097217b46fe3e9ea2f8a09a6e91` 的[具体 helper 结果](https://github.com/xhc144/caiwu-suite/blob/bd2e47a1afc480ba34796e64b2c454ebb024114f/packaging-next/evidence/release-candidate/host-integration-6f56a67.json) | 干净源 locked 自包含发布、实际 helper 子进程与四附件/身份组件。准备 workflow 不生成安装器，不是安装产品验收 |
| P | 已安装部分运行源 `64cc066184ec32f7a9d481fc86f0f657c5d9794b`，[原始部分结果](https://github.com/xhc144/caiwu-suite/blob/bd2e47a1afc480ba34796e64b2c454ebb024114f/packaging-next/evidence/release-candidate/native-installed-64cc066-partial.json) | `success=false`；实际登录、锁定身份、从安装目录加载 runtime 且不载入源码目录已记录，随后 product window 超时。不能据此认证凭证/升级/卸载 |
| I | 源同 C，[内部安装 QA 40189257949](https://github.com/xhc144/caiwu-suite/actions/runs/40189257949) | 本次核对时仍在运行：构建独立控制器已过，安装场景尚无最终通过结果。内部 `INTERNAL-UNVALIDATED` 候选及其测试版本不是用户交付版本 |

后续 CI 若已完成，应下载并核对其 JSON、源身份、失败/跳过及截图，再更新矩阵；不能只把 Actions 总状态改成整套“通过”。未把上一轮失败消去，也未运行或宣称本机 Windows 实测。

## 最终交付前最小补齐项

1. **候选身份：**最终集成源完整 SHA、确切产品版本、安装包实际文件名/长度/SHA256 与发布清单。当前文档不虚构这些字段；内部 QA 两个版本不得转写成用户版号。
2. **已安装证据：**安装 QA 的确切源 SHA、run/artifact、完整业务 JSON、主窗/模态窗口截图、启动快捷方式与受管标记；逐项记录实际通过、失败或未运行。保留忙态阻断、账套及全部附件/可信收据、全局身份、未知文件保留的断言。
3. **用户边界：**实际签名状态、真实支持 Windows 环境、首次设置/角色、实际备份和恢复入口；身份备份仍无菜单时提供受控支持流程，不承诺一键整机恢复。实际 feed/凭据未配置则继续写关闭，不新建服务或 token。
4. **窄范围集成建议：**核对 PR29 小屏修复 `49b194e…` 与新证据后由其 owner 集成、在主宿主复验。本候选的 About/报表中心仍有“完整权限认证/设计器尚未开放”的旧概括文案，BookTools tooltip 仍称 Windows 并发待验；由 Desktop owner 按最终范围修订，不因此扩大功能承诺。本分支未越目录修改。
5. **继续保留的限制：**民非主账务只读/禁止新建、成本不自动记账、有限设计器、无原账套/旧身份自动迁移、无原地 schema 升级/断电恢复完成声明。IME、其它 DPI、多屏和真实打印/PDF 未覆盖时明确列出；交付暂停由负责人按实际验收处理，本说明不解除门槛。

## 本次文档检查与集成

改动仅限 `docs/user-guide/**`。核对了当前源码的启动/登录/菜单/快捷键/受管附件和恢复入口，比较了上述独立 QA 生产子树与 C 的差异，并读取 CI 实际 job 状态；没有重新运行产品测试，也没有把已有组件结果当作本轮新测试。提交前执行路径范围、Markdown 本地链接、UTF-8 和 `git diff --check` 检查。

把本分支文档提交拣选到最终候选即可；不需要改 solution、Contracts、CI 或安装器。交付负责人在验收后补齐上列确切字段并更新 I 的证据快照，再选择将用户说明随包交付。开发矩阵用于评审，不把内部候选调度信息混入用户说明。
