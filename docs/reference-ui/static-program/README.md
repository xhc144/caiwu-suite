# 程序模块静态研究：首批可复用结果

基于开发分支提交 `dc6e08cca3df4788f400de2ca62bd18b3fa0c92d` 中主协调已核字节生成的清单，本轮已复算：**453 条载荷记录，177 个不同 SHA256；179 条 PE 记录对应 63 个不同 PE 内容；870 条 DLL 名级直接导入关系；55 条 PBD 记录对应 43 个不同内容。** 这些是元数据层复核，原 EXE/PBD 未跨容器交付，本轮没有重新解析其字节。

三个主 EXE 的既有 PE 摘要都显示 x86、CLR 目录长度 0、导入 `KERNEL32.dll` 和 `PBVM90.dll`，可确认 PB9 运行时依赖。不能据此判断每个对象的 p-code/native 编译方式、恢复了原工程或得到完整业务调用图。

| 包 | FILE 记录 | PE 记录 | PBD 记录 | PE 资源叶记录 |
|---|---:|---:|---:|---:|
| 轻松 | 154 | 64 | 17 | 4508 |
| 民非 | 147 | 57 | 17 | 4161 |
| 成本 | 152 | 58 | 21 | 4185 |

资源叶是 PE 资源树计数，包含重复载荷和运行库，不是窗口或控件数。`package-comparison.json` 保留分模块分布；本轮没有资源 ID、叶偏移或资源内容，不能补造它们。

## 对开发判断有影响的发现

1. 三包同名同大小的 `rhzw_root.pbd`、`rhzw8_1.pbd` 至 `rhzw8_9.pbd`，其 SHA256 均随包变化。`rhzw8_gz1.pbd`、`rhzw8_zc1.pbd` 在民非与成本包内也同大小异哈希。**同名或同大小不能去重；哈希变化本身也不证明业务算法变化**，需比较对象索引和逻辑对象内容。
2. `rhzw9_cn0/1/2.pbd`、`rhzw9_root.pbd` 与 `pbdwr90.pbd` 在三包内分别同哈希。`rhzw9_g/g1.pbd` 在轻松与成本包内同哈希。可以在元数据处理时去重，不能直接认定它们均被主程序使用。
3. 轻松包 `asa8/dbbackup.exe`、`dbunload.exe`、`dbvalid.exe` 各有两条同目标路径、不同哈希记录，分别依赖 `dbtool8.dll` 与 `dbtool9.dll`。`dbeng8.exe → dbserv8.dll` 和 `dbeng9.exe → dbserv9.dll` 也是直接导入事实。安装覆盖规则、配置和启动调用尚未解析，**目录 asa8 不能证明实际选用数据库版本**。
4. `pbodb90.dll → ODBC32.dll`、`pbmss90.dll → NTWDBLIB.dll` 为载荷中的直接导入关系。它们表明附带连接组件有这些依赖；没有证据证明主业务实际选择了其中哪个接口或连接何种数据库。
5. 179 条 PE 的摘要都为 CLR 目录 0。这仅针对所列 PE；动态加载目标、外部组件及对象内部编译方式仍未知。

## 交付文件

- `summary.json`：计数、主程序哈希、路径冲突和已知限制。
- `inventory.json`：全部 FILE 稳定 ID `installer:record`、原路径、相对落盘路径、大小与哈希，以及按内容分组。
- `dependencies.json`：179 个 PE 记录和 870 条 DLL 名级导入边；每个模块关联既有 `program-types.json` 的 JSON Pointer。匹配同包同名文件只列为候选，未冒充 Windows 加载器解析。768 条未在包内找到同名载荷的导入不等于缺失依赖，可能是系统或外部模块。
- `package-comparison.json`：PBD 逐族差异、PE 资源分布。
- `behavior-research-specs.json`：六条关键业务研究链的证据要求、待定位入口和严格未知项。手册仅用于稳定 page-id 定位，不当作程序调用事实。
- `coordinator-request.json`：精确到哈希、记录和落盘路径的就地分析请求。无需传原字节；优先三个主 EXE，再处理不同内容的业务 PBD。
- `pb_container_probe.py`、`test_pb_container_probe.py`、[RUNBOOK.md](RUNBOOK.md)：标准库只读容器探针、29 项作者实跑测试和执行指令。探针不导出对象本体或完整字符串，不执行原文件。
- `build_research.py`：从固定哈希源清单重建本批五份派生 JSON。

## 事实、推断与未知

本目录的直接事实来自固定版本清单和 PE 摘要；每项均可追溯记录 ID、SHA256、源 JSON Pointer。原始 PE 字节偏移、导入符号、导出表、RTTI、对象目录和函数/事件索引尚未收到，不能以名称代替。由名称产生的模块用途、字符串产生的绑定只允许标为推断。

真正的业务调用边必须有：源文件哈希、对象/函数或事件表偏移、调用操作码偏移、目标 ID/符号、解析版本依据与置信度。当前业务语义图为空，状态为 `blocked_pending_coordinator_probe_results`。这不阻止交付已知 DLL 依赖图和清晰的下一步规格，但不能声称软件已完全分析清楚。

## 复现与验证

```sh
python3 docs/reference-ui/static-program/build_research.py \
  --source docs/reference-static \
  --output docs/reference-ui/static-program
cd docs/reference-ui/static-program
python3 -m unittest -v test_pb_container_probe.py
```

生成器核对两个源文件 SHA256 后才运行；输出顺序固定。源文件更新必须审查差异并显式更新固定值。PB 容器格式、可信工具比较和原字节处理命令见 RUNBOOK。原源码未取得；没有复制商业实现代码，没有运行原 EXE、搭建兼容环境或处理授权/激活。

探针修复提交 `ca59dabf1f3c0fe358f4fea478e7dfb42006be32` 的作者验证：`python3 -W error::ResourceWarning -m unittest -v test_pb_container_probe.py` 实际运行29项全过，其中19项内存容器测试、10项临时夹具批处理测试。主协调转述的独审结果须分别理解：19项内存容器测试由独审实际运行并通过；另10项临时夹具测试仅审阅代码，未由独审执行。真实 PB9 输入验证仍为 **0**，不能把这些测试作为真实对象或业务解码验收。

当前探针版本1.1、输出 schema 2；探针 SHA256 `ffa86364960b999a93ef687707602b8481b5176ee7de606c87bc2b7a6b79dd50`，测试文件 SHA256 `e5919f015a55645c48e1d6cb2ec95f05eb86a5df08f584e1a891a5ef435441c6`。完整文件大小及哈希见 `validation.json`；等待主协调取得真实结构结果后再推进函数/事件表。

## 交接状态

2026-10-25，本任务实际目录 `/workspace/caiwu-static-program`；未修改预挂载 `book-project`。`/workspace/.agents` 为空，项目树无适用 AGENTS/技能文件；已使用工程交接技能，记录仅写入本任务独占目录。

完成：元数据固定版本校验、JSON 模块图、版本/资源分布、合成容器解析检查和主协调就地分析脚本。待回传：原容器报告；待研究：PB9 对象内部版本门控与函数/事件解码、关键持久化调用及动态派发。没有授权拒绝；阻塞是原始字节仅由主协调持有，现已提供不需跨容器传原件的路径。
