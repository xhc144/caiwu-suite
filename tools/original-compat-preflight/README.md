# 原账套只读预检

`preflight.py` 为后续兼容核验生成真实输入清单。Python 3.10+ 标准库，无需数据库、ODBC、PowerBuilder、管理员权限或凭据。只读取逐个明确选择的本地普通文件，不启动原 EXE/数据库引擎，不连接数据库，不上传，不迁移或修改源文件内容。

本工具不是账套打开器或 SQLite 迁移器。`inventory_status: complete` 只表示选中的文件都完成了稳定读取与 SHA256 记录；`compatibility_status` 和 `original_ledger_usability` 始终为 `not_assessed`。原账套是否能用、备份是否一致、日志是否属于该库，均须后续验证。

## 使用

先选择封存备份的另一份本地副本。每个输入都要显式列出，不接受目录，不递归扫描，不根据配置自动跟踪路径。输入、关联声明和输出路径均拒绝 `..` 父目录组件（包括 Windows 分隔符/盘符语法），在任何词法归一化或文件读取前返回参数错误；请直接指定所需路径，不通过 `resolve` 消除或跟随链接。文件不存在时可照常列为预期输入，报告会记录 `missing`，不创建它。

```sh
python3 tools/original-compat-preflight/preflight.py \
  --database /local/test-copy/Rhzw01.db \
  --file /local/test-copy/Rhzw01.log \
  --file /local/test-copy/Rhzw8.ini \
  --file /local/test-copy/Bb000.vts \
  --log-for /local/test-copy/Rhzw01.db /local/test-copy/Rhzw01.log \
  --config-for /local/test-copy/Rhzw01.db /local/test-copy/Rhzw8.ini \
  --report-for /local/test-copy/Rhzw01.db /local/test-copy/Bb000.vts \
  --output /local/reports/new-inventory.json
```

示例路径不代表原软件确实按这个名称存放日志或相关文件。不同目录/文件名可显式关联；已存在但未选择的日志不会被发现。`--log-for` 等仅记录操作者的声明，不能证明库内真实关联。

可重复 `--database` / `--file`；后缀 `.db` 也会作为数据库候选列出。没有 `.db` 后缀的数据库可用 `--database` 声明。`--log-for`、`--config-for`、`--report-for`、`--dbspace-for`、`--attachment-for` 均接受两个已明确选择的不同文件：数据库及关联文件。不需要提供用户名、密码、密钥或连接字符串，也没有接受这些参数的入口。

默认输出 JSON 到标准输出。`--output` 只创建一个新的报告文件，不创建父目录，不覆盖任何已有路径，不接受符号链接/reparse point，也不能与任何选中输入同路径（即使该输入尚不存在）。报告与源文件分开放置。默认不输出完整路径，只记录输入 ID 和文件名；`--include-paths` 可明确选择在本地报告中记录绝对路径。文件名、路径、大小和哈希也可能包含业务信息，报告保持本地，不提交到 Git 或上传。

## 报告能证明的范围

- 每个所选文件的大小、SHA256、读取状态；读取期间发生变化则不输出其哈希/版本结论。未找到/无权限/非普通文件分别记录；不提权、不重试改权限、不跟随符号链接/reparse point。拒绝 URL 和 UNC 网络路径；挂载盘是否真正为本地介质仍由运行环境确认。
- 不读取配置字段，不输出配置正文、口令、连接字符串、数据库内容或归档内容。哈希必然读取文件字节，但不保存原始字节。原始配置内容不会进入报告或错误文本；文件名本身由操作者选择，工具不保证文件名中人为放置的秘密会被识别。
- 可核实的静态提示仅包括 SQLite 的固定文件签名、有效 PE 头的格式/架构，以及 PE 版本资源的 `VS_FIXEDFILEINFO` 数值。PE 中声明的文件/产品版本不是数据库文件格式或实际运行引擎版本，也没有验证发行者签名。`dbeng8.exe` 等名称只产生明确标为未核实的文件名提示，改名不能成为版本证据。数据库文件版本和应用 schema 版本保持 `null`。
- 静态元数据读取对每个文件累计限 1 MiB，文件前缀、PE 头、资源目录及最多 16 个版本叶节点的读取共用同一预算；另有结构、偏移和资源数量限制。报告记录 `metadata_bytes_read` 与 `metadata_byte_limit`。不加载 DLL、不执行 EXE、不反编译；无版本/损坏/超预算时保留未知，仍可完成稳定文件哈希。
- 关联缺项按每个数据库候选列出：日志/配置/报表未声明、声明的文件不可读或缺失、尚未由引擎验证，以及外部依赖/备份一致性/schema 未知。同名日志仅列为文件名候选；不会自动把它与数据库绑定。缺少选择不等于磁盘上缺少文件。

默认限 256 个不同路径、单文件 2 GiB、总哈希读取 4 GiB，可用 `--max-files`、`--max-file-bytes`、`--max-total-bytes` 显式调整。超预算会记录未读取，不截取一段就输出完整文件哈希。重复的相同规范路径只记录一次；不会按相同文件名合并不同目录的文件。

退出码：`0` 为所选文件清单完整采集（仍可有未决关联/兼容缺口）；`1` 为有选中文件缺失、拒绝、不可读、变化或超预算；`2` 为参数/关系错误或报告无法创建。错误不回显原始路径、配置正文或系统错误详情。参数错误在读取输入前检查。

PE 结构及数值版本字段依据 Microsoft 的 [PE Format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)、[VS_VERSIONINFO](https://learn.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo) 和 [VS_FIXEDFILEINFO](https://learn.microsoft.com/en-us/windows/win32/api/verrsrc/ns-verrsrc-vs_fixedfileinfo) 文档；工具只实现上述受限静态读取。报告使用 ASCII 转义 JSON，读取报告后仍可还原 Unicode 文件名，不依赖控制台支持的字符集。

读取可能使文件系统更新访问时间；工具不会通过改权限或恢复时间戳来掩盖它。选择独立副本；本工具不保证运行中的数据库、网络挂载或外部并发写入能够获得一致快照。POSIX 使用目录描述符和 `O_NOFOLLOW` 避免路径组件替换跟随；其他平台进行组件和读取前后身份检查，Windows 原生运行仍需另外验证。

兼容研究与后续门槛见 [原账套兼容路线](../../docs/revision-plan/original-data-compatibility.md)。本轮只以临时生成的合成文件测试，没有读取原程序、原数据库或用户账务文件。

## 合成测试

```sh
python3 -W error::ResourceWarning -m unittest discover \
  -s tests/original-compat-preflight -p 'test_*.py' -v
```

测试生成虚构 DB/日志/配置/PE 字节，不存入任何原始或反编译资料。测试覆盖稳定哈希、隐私、版本提示边界、关联缺项、显式选择、缺失输入、预算、链接/特殊文件拒绝、变化检测和报告不覆盖；不证明原账套兼容。

2026-10-25 初版 36 项 Linux 合成测试通过后，独审发现 `abspath` 会先折叠 `link/../file.db`，导致链接组件未被检查且可能记录另一个文件的哈希。0.1.1 在归一化前拒绝 `..`；新增输入链接/父目录、输出链接/父目录及本机/Windows 词法边界测试，修复前这 3 项产生 6 个失败。独审还发现初版 1 MiB 实为单块限制；0.1.1 改为整个文件的累计元数据读取限制，并新增 16 叶节点合成 PE 回归，超预算不输出版本但保留完整稳定哈希。修复后全部 40 项通过、无跳过。包含独立 Python 进程的真实 CLI 调用，但所有输入均为测试当场生成的虚构文件；未使用真实账套。`--help` 和差异空白检查通过。工具源码未导入数据库、进程执行、网络或动态库加载模块，未调用权限/时间戳修改操作。Windows 原生运行、真实数据库和原程序对照未执行，仍不据此宣称原格式可用。
