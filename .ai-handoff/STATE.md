# caiwu-suite 主集成交接

## 本分支第二阶段接续

2026-10-25 10:57 UTC本阶段收尾：核心完整Windows基线1f4e9ea14aad44de3a2c6673811808260ee43922/run40184804270成功；额外认证候选生产树74fc20d、最终测试代码10e38ff65313aae5106a6b55c42790d47345b8fb定点40186708406成功（旧窗口6/焦点2/视觉10），但14新窗口/真实产品启动/候选全量/安装尚未验。Managed9ca1deb和Feature新末段未接入。后续QA先读docs/acceptance/evidence-sprint-integration-2/candidate-packaging-handoff.md；不解除暂停、不把未暂停RID打包路径称为clean。

`codex/sprint-integration-2` 的当前状态、导入来源、实际 Windows 证据和未完成项见 [第二阶段集成记录](../docs/acceptance/sprint-integration-2.md)，草稿 PR16 目标是 `codex/windows-revalidation`。以下原有记录描述较早的 `codex/windows-mvp` 阶段，不能代替第二阶段实际验证。交付暂停门槛仍在，未生成新分发包或合并 main。

2026-10-25；实际工作树 `/workspace/caiwu-suite-dev`，仅 `codex/windows-mvp` / 草稿 PR1，不合main、不改私有权限或原安装包。更早的中间状态已由git历史保留，此处只记当前事实。

用户已明确授权自研、适量并行、开发分支提交推送和草稿PR。原安装器的具体执行已由独立观察任务另外确认并获批准；本任务不运行它。观察任务报告Wine32加载失败，无安装或原软件窗口，不是仍待授权。

## 当前优先级

独审对037a075发现5个P1，试用交付暂停。`docs/acceptance/DELIVERY_PAUSED.md`门控禁止分发ZIP/安装器，旧本地ZIP已移到artifacts/quarantined作为复现材料。不能因旧138检查绿灯宣称可用。

- P1 UI修复已推d34b1f15a028e5207e61b2102298fa411e78d2f5：移除覆盖Fluent的DataGrid隐式样式改本地属性，金额严格分组+整数分解析，保存错误留窗、SQLite busy中文提示、单次保存、科目真正保存后才关窗。
- 最终窄契约已推0d2ae9e379b02c2d86bbd174f56dcd437f910206：VoucherDraft末尾ExpectedRevision与ExpectedBookId。已有草稿必须匹配同一编辑快照的账套ID+版本；UI已传，Core owner实现待回传。未改Core生产源码。
- Core停用科目期初修复3643bcc→本分支35bf78c；58测试过。SQLite63、Reporting45、UI逻辑27、实际闭环9过；WPF交叉构建0警告0错误。
- 旧独审控制台18项当前16过2失败：ACC002待Core token实现，ACC005仍复制旧catch表达式，需要独审方适配。不能用此静态旧表达式代表当前真实Save handler；原样7项实际Windows WPF探针已接入CI，包括真实锁冲突和原生双击。
- Windows实际新UI结果待Actions run40174541219，不得仅靠交叉编译声称已目视修复。旧trial-balance.png已实际目视，确有列宽塌缩。

## 当前功能/边界

真实Core+SQLite+Desktop已组合：账套、科目期初、凭证草稿审核记账、余额明细追溯、备份恢复。已记账只读。完整身份认证/财务报表/年结/原账套导入/成本界面持久化尚未完成。民非维度缺失，Desktop新建禁用且已有实验民非账套只读，不能仅换模板声称支持民非。没有财务合规认证结论。

Reporting原模块与45单测、9集成已合，Main仍有旧自拼CSV需改用审过Reporting；本地ReportCenterWindow和ReportPrinter集成未提交，不作已接通承诺。Rules e00已合，企业编码9仅样例不完整。新Rules9956、Reporting b4e299、Costing398ed、Delivery87b3均暂不抢P1。

## 工具和共享参考

官方SDK10.0.402位于.tools/dotnet，SHA512已核。tools/dotnet-local.sh使用工作区XDG_RUNTIME_DIR与NuGet缓存解决迁移锁，不修改HOME/宿主权限。Linux只交叉构建WPF；自研实际Windows验证在已授权私有repo CI。

统一原界面索引docs/reference-ui/README.md、pages.json：26通用节点+2未见专版子页；旧31编号保留别名。原11截图仅私有Library研究包libfile_442a588c36dc8191bf833338100c9a0e，version0，193504B，sha b686e5b13011b1615fbf33b991940795a60c643624b34eb1aae8ef43047ccd20，不进新代码。较新观察包HTTP401未保存，勿冒称新版本。

旧artifact重定向blob403已停。父提供受支持GitHub工具github_download_workflow_artifact，可取新证据；旧PNG由独审入仓可本地读。大文件Library上传helper在tools/list HTTP401未开始，没有新ID，不绕过helper。
