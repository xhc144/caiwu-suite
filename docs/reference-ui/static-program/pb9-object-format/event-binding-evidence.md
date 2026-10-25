# 6字节事件表与跨库索引：定向证据检查

结论：**本轮未找到足以确认 PB9 三个事件字段及 RefIndex 跨库含义的独立证据。** 可以确认公开读者怎样用 GlobalIndex 合并对象函数槽，但它不是“所有PBD共享的函数编号”。已检查来源、固定提交、blob SHA、未运行的测试及访问限制见 `event-binding-sources.json`；本地判据与构造反例见 `event-binding-checks.json`。

## 新资料带来了什么

本轮检查了 sugitter/pb-devkit 的 Python、Rust 路径和 ahzs645/PbdViewer 的 TypeScript移植及smoke/parity测试。Python文件头明确说明基于Hucxy，仍在 `decompiler.py:649—650` 跳过6字节表；TypeScript在 `PbEntry.ts:257—258` 也是同一路径。其smoke测试检查系统类型对象能否结构性读完；parity输出包含类型、声明、变量、引用名称，未包含6字节字段含义的断言。Rust路径对compiled-only对象指向Python实现，所读测试不证明事件解码。这些是已读源码/测试代码的事实，**本线程没有执行这些工具或测试，也没有把多个移植版当成多份独立格式证据**。

另外检查的clpo13 fork在相关读取文件上与Hucxy具有相同blob SHA；guen-hyunsoo示例的p-code文件与此前PB6示例同SHA。它们没有补上新的独立解释。Hucxy源码的 `RefIndex` 定向检索只返回属性声明和读取赋值；在已读调用解析路径中未发现使用RefIndex来选择另一个PBD或DLL目标的实现。

## 6字节表：哪些仍未定

将三项暂称为A/B/C，而不是直接命名事件ID、函数ID、父类ID。现有唯一具体解释来自PB6示例：A与事件调用选择值相配，B索引当前对象引用表，C经类型解析后参与限定名称。该示例没有给出本批PB9的测试，也没有证明A就是48字节定义中的EventCode。

因此至少要区分三种候选：`B=引用表序号`、`B=本地函数定义序号`、`B=某个RefIndex/GlobalIndex域`。A也可能是内部事件选择值，而非Windows/PBM映射标记。C则需要实际类型表、作用域和编码规则，不能因为高位像0x4000/0x8000就宣称找到所属对象。

官方资料只提供约束：`pbevtid.h`定义事件token映射；另有未映射用户事件，其编辑器里没有事件ID。这意味着不能把所有编译事件都硬塞进PBM编号，也不能以“没有token”否定一个有效用户事件。官方PBNI的GetMethodID又由class、名称、routine kind、签名共同查找；本轮未找到它与持久化GlobalIndex、RefIndex、EventCode数值相等的保证。[事件token说明](https://docs.appeon.com/pb2022/native_interface_programmers_guide_and_reference/XREF_91730_Header_file.html)、[未映射事件](https://docs.appeon.com/pb2019/pbug/ch08s02.html)、[方法查找](https://docs.appeon.com/pb2021/native_interface_programmers_guide_and_reference/ch01s02.html)

恢复线程可在本地执行以下最小鉴别，不需要传原数据：

1. 用顺序解析定位6字节表，并确认其边界恰为计数×6。先保留三个原始u16及逻辑/物理位置。
2. 对每条记录分别尝试B的不同索引域，检查范围、目标是否事件、名称/参数类型是否相容；不要只统计命中率后自动选模型。
3. 特别找一个各域数字不同的事件：引用序号、本地声明序号、RefIndex、GlobalIndex、EventCode不应恰好全相等。再与继承覆盖事件、普通映射事件、未映射用户事件分别对照。
4. 对A，分别比较定义EventCode、可证的事件调用selector及同一类型的继承槽；任何一个相同值都只算一次局部观察，不能直接等同全局域。
5. 对C，以当前entry类型表、同版本系统类型表及引用对象范围独立校验。缺系统表、无目标或多目标均保持unknown。

如果两种解释都成立，正确结果是 `ambiguous`，不是取第一个。若一条解释只在“所有编号都为1”的小对象上成立，它没有鉴别力。

## GlobalIndex/RefIndex：可证链与断点

在Hucxy读取逻辑中，GlobalIndex用作对象的 `AllFunctionDefinitions` 槽：先复制祖先，再由本地声明覆盖。于是可用的身份至少包含“对象类型/所属entry/版本”，不能单独拿GlobalIndex跨文件join。RefIndex在所查PB9读者中只被存下；其通向外部目标的含义仍未定。[继承槽合并](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PbClass/PbObject.cs#L90)

对对象调用，已知边界的指令→routine池8字节descriptor→receiver类型→该类型继承后槽表→声明，是一条可逐段验证的候选链。声明可能属于祖先entry，不能把其目标位置强行记到当前对象文件；名称、参数类型、槽与版本必须一致。STATIC还允许后代覆盖，最终运行时目标应保留集合或unknown。

对全局函数，操作码444的0x8000分支先用**当前对象引用表的序号**取名称；随后global-call消费栈顶名称。所查实现没有在此用 `ReferencedFunctions.GlobalIndex` 直接索引目标PBD。官方FindGroup按名称与group type在当前library list里搜索，因此还缺有效执行库清单及重名消歧。安装包共存目录或一个字符串字典的“最后写入者”不能替代运行时库解析。[压入名称](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PCode/PCodeParserBase.cs#L356)、[官方FindGroup](https://docs.appeon.com/pb2025/native_interface_programmers_guide_and_reference/XREF_85999_IPB_Session.html)

这里还要区分两种“外部库”：其他PBD中的PowerScript对象/函数，与native DLL声明。native DLL候选要先绑定到声明，再读external标志、库名和alias字段；没有 `GlobalIndex→DLL地址` 的已证公式。官方允许LIBRARY声明不写ALIAS，故缺alias不能直接判为没有DLL目标。Hucxy把Library赋值放在alias非0xFFFF分支里，这一读取策略不能当成格式保证；恢复线程应分别检查这两个原始字段。即使库名和导出名匹配，也仍要保留实际DLL加载路径的不确定性。[声明读取](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PbClass/PbEntry.cs#L479)、[官方外部函数声明](https://docs.appeon.com/pb2025/application_techniques/Using_external_functions.html)

## 允许提升结论的最低门槛

本地至少需要一条6字节记录、对应32字节definition、相关48字节声明、引用表数量/该20字节行和作用域已知的类型记录；指令绑定另需已知边界的call及其8字节descriptor。字符串只需在本地检查长度、终止、所属池及相等关系，不需要上传字符串、hex、对象或SQL。

只有同时满足结构边界、索引域、事件身份、类型作用域、签名一致性，并经过编号不重合及跨对象/跨库反例，才可记录为某个版本/样本范围内的已验证映射。跨库目标还必须排除同名候选并证实相关库列表。当前未知项完整保留：A的域、B的确切索引域、C的类型/所属含义、RefIndex的跨库作用、PBNI methodID与持久化索引是否有关联。容器通过和源代码里的变量名都不能代替这些证明。

原作者链接的论坛文章本轮只返回站点验证页，未读到正文，未尝试绕过。本次结论限定于已经检查的公开来源，不宣称其他资料不存在。
