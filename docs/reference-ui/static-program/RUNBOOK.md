# PB 容器结构分析：直接运行说明

当前先交付 `pb_container_probe.py`：Python 标准库实现，只读既有提取文件；输出 JSON 元数据，不导出对象本体、不运行原程序。已用合成 ANSI/Unicode 容器、嵌入 EXE、跨块数据、损坏及循环链检查。**尚未在本任务取得的原 PB9 文件上验证**。

主协调可在持有原文件的目录直接执行，无需再下载解包，也无需跨容器上传原文件：

```sh
python3 docs/reference-ui/static-program/pb_container_probe.py \
  --manifest docs/reference-static/all-payload-file-list.csv \
  --payload-root /workspace/caiwu-suite-investigation/extracted \
  --output /workspace/caiwu-suite-investigation/evidence/pb-container-probe
```

`--payload-root` 必须是包含 `payloads-static-readonly/` 的目录。每条记录先核 SHA256 和大小；同哈希内容只解析一次。结果由 `index.json` 按稳定 `installer:record` 关联到 `<sha256>.json`。输入文件没有写入操作，输出必须位于输入树外。

首批请回传 `index.json`、三个主 EXE 的报告，以及每个 PBD 报告（可 gzip，均为元数据）。不传对象原始数据。若数量过大，先回传状态计数、每个库的 header_offset、encoding、format_version_raw、对象数、扩展名分布和所有 errors。

## 已实现的证据粒度

- 512 字节对齐 HDR、ANSI/Unicode 头、NOD/ENT 对象索引、DAT 链、TRL 头指针。
- 每个对象的目录偏移、名称及扩展名、声明大小、完整逻辑内容哈希、逻辑偏移到物理文件片段的映射。
- PB 风格名称与业务词的有界命中，只输出词及位置。库内名称可与声明索引相配，但关系仍是 `text_name_occurrence_not_call_or_inheritance`。
- 字符串特征可提示 DataWindow 文本候选；不输出整段 SQL 或商业实现。每个对象 `function_event_table_status=not_decoded`，调用图明确为空且标为未解码。

## 格式与工具路线

优先依据 [Arnd Schmidt 的 PBL 结构说明](https://www.dwox.com/PBL_File_Format.txt)，原作者说明适用 PB5—11.5，并明确部分名称是逆向推定。本脚本只独立实现其容器布局。`0400/0500/0600` 是原始格式字符串，不能直接读成 PB 主版本号。绝对文件偏移与首个对齐 NOD 的选择均写入 JSON；不能证明库的运行时激活状态。

[PBDumper 作者页](https://sebkirche.github.io/pbdumper/) 报告测试 PB5—11.5，可作为容器结果的第二实现比对。但本轮通过 GitHub 连接器读取作者同名仓库返回 404，未取得可审查源码；未下载或执行其 EXE。待源码来源与构建可核后才考虑采用。

[sijms/PowerBuilder-decompile](https://github.com/sijms/PowerBuilder-decompile/tree/5a7b9b05a400ddef8515dbf74e6fcd51a2e741a4) 为 MIT，README 明示不完整且只测试 PB6。本轮只检查了 `pbd_dump.py` 和部分类型表，没有执行、没有复制它的解析实现。其容器代码缺少本任务需要的链边界、路径及结果分层检查；PB6 的 p-code/系统函数编号不能直接用于 PB9。下一阶段若采用，须先检查 `definitions.py` 和 `pcode.py` 的版本门控，以本批字节交叉验证，再为函数表、事件表、调用操作码分别建立独立证据层。

## 明确未解析

尚未解码对象内部的类型/祖先、函数签名、事件 ID、p-code、调用目标、DataWindow 表达式与 SQL 绑定。容器成功不等于获得源码，不等于业务调用图。`string_occurrences_not_calls` 只用于安排后续查看位置。

遇到 `partial`：先回传 errors 和偏移；不要用猜测的相对指针修补，或忽略哈希。当前只支持绝对文件偏移；不支持非 512 对齐容器、压缩/保护数据、PB 之外的容器。缺字节为 `missing_bytes`；哈希错误拒绝分析。授权/激活相关程序仅存在清单中，不属于本探针的 EXE 输入白名单。

## 本地验证

```sh
cd docs/reference-ui/static-program
python3 -m unittest -v test_pb_container_probe.py
```

这些测试验证解析器的边界处理与偏移映射；不证明原程序的函数语义，也不替代原文件验证。
