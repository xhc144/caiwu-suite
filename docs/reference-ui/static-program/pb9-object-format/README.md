# PB9 对象内部格式：供真实字节线程逐字段验证

本目录研究对象内部记录，不重复容器探针。已核查公开 [PbdViewer 固定提交](https://github.com/Hucxy/PbdViewer/tree/b46fd3e42b8f26ed18a547b9e4bec47f96530a86) 的实际读取路径，并与此前 PB6 示例交叉检查。**已知的是外部读者怎样解释字节；本线程尚未读本项目任何对象内部字节，以下目标兼容性均未验证。** 未下载/运行外部工具，未复制其实现，也未上传目标文件、原始对象或资源 catalog。

最有用的三处区别：

1. `0x00C1/0x00C4` 对象版本在公开读者中走 `PCodeParser90`，函数定义宽度48字节；容器头的 `0600` 是另一层格式标记。[版本选择](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PCodeHelper.cs#L661)
2. 自身类型来自16字节 class slot 的 `+2`；32字节 definition 的 `+0` 被该读者用于继承类型，`+2` 才是父容器类型。此前 Python 示例把第一项称为 class_id；直接沿用会连错继承边。[实际读取](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PbClass/PbEntry.cs#L315)
3. 该 `Parser90` 把操作码5、6、7分别解释为 commit、rollback、disconnect；旧 Python 示例把6解释为 commit。因此必须先确认完整指令边界和版本，不能从字节或词语搜索推出事务调用。[Parser90](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PCode/PCodeParser90.cs#L107)、[旧示例](https://github.com/sijms/PowerBuilder-decompile/blob/5a7b9b05a400ddef8515dbf74e6fcd51a2e741a4/pbd/pcode.py#L681)

## 记录边界和表序

机器可读偏移与原始来源见 `format-spec.json`，版本分支见 `version-differences.json`，全部已读源文件 blob SHA 见 `sources.json`。偏移均为零起点、小端，指向逻辑对象/记录/所属池，不能直接当成 PE RVA 或 PBD 物理位置。

候选 C1/C4 对象头固定26字节：`u16 version, u16 flags, u32 entry_type_raw, u32 unknown, u32 modified_time, u32 compiled_time, u32 unknown, u16 leading_count`。随后是 `leading_count*12` 个尚未解释的记录。头中 entry_type 的更具体位含义尚不清楚，不按扩展名倒填它。

后续顺序为：entry值池 → 全局/共享变量lookup → 两个u16（class slot与definition数量）→ function字符串池 → parameter池 → 类型lookup → 枚举lookup → class slots → definitions → 各对象体。该读者的 StructBuffer 总是两个u32长度后跟 data 和 auxiliary，第二段不能未经检查就称为填充。lookup 为6字节未知头、StructBuffer、u16表字节数、20字节记录数组；新实现必须检查表字节数可被20整除，不能照搬源读者的整数截断。

class kind0 按出现顺序消耗下一个definition，并读对象体；不能简单把 class ordinal 当作 definition ordinal。kind1 后有枚举成员记录；kind6及其终止分支在本规格中保持未知，不臆造跳过策略。任何无法完整落在逻辑对象内的读取都应停止该对象并记录精确位置。

对象体先有 `u16 body_count` 和 `body_count*4` 的索引。每个routine读取6字节头（p-code字节数、debug记录数、未知u16），继以p-code、debug_count*4、局部变量lookup及routine池。随后按definition内计数读取6字节表、4字节表、引用函数lookup、变量lookup、8字节表、16字节表，最后才是本地48字节函数定义。完整顺序列在 JSON，不把其中未知表擅自命名。

## 函数、事件和继承的可靠程度

48字节函数定义中，`+0` 是函数名在 FunctionBuffer 的偏移；`+8` 是参数在 ParamBuffer 的偏移；`+20` 为 GlobalIndex；`+22` 为 RefIndex；`+28` 为返回类型；`+30` 为参数数；`+31` 为标志；`+32` 为 EventCode。事件标志bit0，外部声明bit2，private/protected为0x10/0x20。函数名、参数名、别名和库名的指针都必须按各自所属池单独校验。源码的0xFFFF缺省检查及bit31偏移掩码有记录，不能悄悄清高位后当成已验证地址。

routine索引第二个u16，在该工具UI中用作**本地 FunctionDefinitions 数组序号**；它不是自动等于 GlobalIndex 或 RefIndex。请将三种绑定分别比较，记录是否一致。旧 Python 示例按另一个索引域匹配，不能用其名字填充目标routine。[绑定位置](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/DataModel/EntryNode.cs#L60)

GlobalIndex用于继承后的函数槽：该读者先合入祖先表，再按本地 GlobalIndex 覆盖。父容器对象与祖先对象分别解析；不能把控件所属关系画成继承。目标文件中须额外检查槽数、越界、祖先循环、同名/重载、缺失系统类型和库搜索歧义。[继承合并](https://github.com/Hucxy/PbdViewer/blob/b46fd3e42b8f26ed18a547b9e4bec47f96530a86/Uitils/PbClass/PbObject.cs#L90)

6字节表是本次最明确的缺口：PbdViewer只跳过 `6*definition[24]`，**没有解码它**。PB6示例把三项u16解释为事件ID、引用索引、类型ID；它只是一条可比对假设。应以 EventCode、引用表范围及继承关系交叉核实，未完成前只保留三个原始整数。不能声称事件表已恢复。

## 类型引用和 p-code 目标

公开读者按类型值高nibble区分：0为基本值类型、4为系统类型表、8为entry类型表、C走缺省分支。C族的真实含义本线程不扩张解释；保留原值并标未解析。类型名称来自20字节表内 `+8` 的池偏移，`+16==0x40` 被读者用于引用对象标记。系统类型编号需要相同版本类型表；本研究没有下载其内嵌 `.bin` 或默认采用其中编号。

候选对象调用操作码41/330/331/366/539，表中均有4个u16操作数，即10字节指令：`u32 routine_pool_descriptor_offset, u16 argc, u16 flags`。目标descriptor再读取8字节：`u16 inherited_slot, u16 type_ref, u32 name_offset`。这比字符串命中强，但仍要追踪receiver的类型、继承后的槽表及名称一致性。flags的1/2/4由该读者用于post/dynamic/event；只把它们标为候选，不把post当同步执行。

全局调用还需保留栈来源：444先压入函数名（函数索引、对象索引），445—448/540再消费名称及参数。0x8000分支从当前对象引用表取名，0x4000分支访问系统对象；仅见后一个call操作码无法知道目标。18候选super调用读取5个u16操作数；源实现对其中字段利用不完整，不能据其输出文本就认定父类绑定已证实。

即便标为STATIC，对象调用仍可在运行时落到后代覆盖；官方文档明确保留这种多态。因此结构图宜分别记录 `declared_slot`、`possible_overrides`、`runtime_target_unknown`，不要把编译期槽等同于唯一运行时目标。[官方调用语义](https://docs.appeon.com/pb2022/powerscript_reference/xREF_33712_Static_versus.html)

## 最小本地验证与合成模块

`validation-plan.json` 给出按阶段检查的最小长度、字段、断言与失败口径。真实字节及任何hex始终留恢复线程本地；本规格不请求上传对象、p-code、SQL、资源或catalog。

`record_probe.py` 是本线程自写的固定记录读者，**没有文件I/O**。它只接受精确长度的记录切片，并只支持候选版本C1/C4；输出始终带 `target_layout_validated=false`。小型指令函数要求调用方显式确认已知指令边界，未知操作码即拒绝，绝不在任意字节间搜索重同步。它不是全量对象walker、完整指令表或反编译器，也不会生成调用边。

在本目录运行 `python3 -W error::ResourceWarning -m unittest -v test_record_probe.py`：作者实跑15项合成测试通过。覆盖字节序、偏移域、版本不符、精确长度、函数槽区分、标志优先级、继承域、低证据事件表及未知指令停止。合成测试只验证自写读者的机械实现；真实对象内部格式验证仍为0。
