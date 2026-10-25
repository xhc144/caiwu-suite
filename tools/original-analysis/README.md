# 原版静态分析：重新生成步骤

这些脚本根据三个原版安装包生成 `docs/original-analysis/`。安装包在 Release `reference-installers` 中，只供内部研究，不要把原版文件或反编译原文提交进仓库。

需要：Windows、.NET SDK 10、Python 3.10+。

1. **解包**：用 `tools/pb-static-toolkit/toolkit.py extract`，清单为 `docs/reference-static/all-payload-file-list.csv`，传入安装包 SHA256 和全部 `--record`。只有重复的 `asa8\dbmsql9.dll` 会报 unique match 错误，跳过即可。然后按 `original_destination` 把文件恢复成原文件名，每个产品放一个目录，例如 `named/qingsong-kuaiji-setup/`。
2. **反编译导出**：
   ```bash
   cd tools/pbdviewer-export/exporter && dotnet build -c Release
   PbdViewer.exe <product> <named目录>/run_zw8.exe <pbwork>/ex/<product>/run_zw8
   ```
   对 8 个程序各执行一次。产品与程序对应：qingsong：`run_zw8`、`rhzw9_cn0`、`rhzw9_fp0`；minfeiqi：`rhzw8_mfq`、`rhzw9_cn0`；chengben：`rhzw8_cb`、`rhzw9_cn0`、`rhzw9_fp0`。输出目录结构为 `<pbwork>/ex/<product>/<program>/`。
3. **DataWindow 与模板 DDL**：用 `tools/pb-static-toolkit` 的 `analyze --stages dw` 解析 DataWindow，得到 `datawindows-compact.json`。账套模板 `aNN.acd` 解压后读取 `rhsj/data_stru.txt`，得到 `template-schemas.json`。两个文件放在同一目录 `<dw-dir>`。
4. **生成文档**：
   ```bash
   python -X utf8 tools/original-analysis/render.py <pbwork> <dw-dir> docs/original-analysis
   python -X utf8 tools/original-analysis/tables.py <pbwork> <dw-dir> docs/original-analysis
   ```
   `README.md` 和 `gap-analysis.md` 是手写的，生成时不会覆盖。另外，`<pbwork>/named/<setup>/aclist.txt` 用于读取会计制度模板名称。

`tools/pbdviewer-export/` 改造自 [Hucxy/PbdViewer](https://github.com/Hucxy/PbdViewer)（MIT，b46fd3e），见 LICENSE。主要改动：
- GBK（CP936）解码；
- 系统类型资源从输出目录读取；
- 编译器临时变量名改用 Ordinal 比较；
- ANSI 嵌入 SQL 参数按字节偏移；
- 保留事件中的提前 return；
- 保留 SQL 游标声明；
- 新增 JSON 导出入口 `exporter/Program.cs`。
