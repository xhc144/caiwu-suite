# 三安装包静态解析交接

本目录全是生成的清单、哈希及格式/资源目录分析，没有原EXE、DLL、PBD、ACD、图标、图片、代码或真实账务数据。仅内部研究，不公开分发原软件。

- `all-payload-file-list.csv`：三安装包全部FILE记录，轻松154、民非147、成本152，共453。列出原目标路径、大小、SHA256和本任务落盘相对路径，保留重复记录，不把记录数冒称唯一文件数。
- `program-types.json`：每个PE文件的位数、CLR目录大小、导入DLL和资源叶节点数量。
- 完整资源目录另外保存在本任务的`/workspace/caiwu-suite-investigation/evidence/all-payload-static-catalog.json`及生成的gzip研究文件；均不含资源本体。哈希及大小在`provenance.json`。本仓库先提供可直接消费的完整文件CSV与全部PE类型/导入摘要，不冒称已跨容器传完完整资源分析。

三个主程序run_zw8.exe、rhzw8_mfq.exe、rhzw8_cb.exe均为x86 PE32，无CLR目录，导入KERNEL32.dll与PBVM90.dll。可以确认PowerBuilder9运行时依赖，不能称获得原始工程或源码。窗口对象可能在编译PBD中，Windows PE资源目录不等于全部窗口/控件定义；由资源研究任务继续只读解析，不凭工具能力推造未见字段。

三包分别含60个ACD记录；PBD数量为轻松17、民非17、成本21。存在DB/VTS/INI等文件只说明载荷文件形式，尚未核其数据库版本、表结构、字段含义或可迁移性。不得为了分析运行附带脚本、许可/激活程序或接入真实账务。

本任务的全部载荷已经从现有解压流按已核偏移/长度复制并校验哈希，未重新下载三包，未执行载荷。原提取目录保留，新的落盘目录为`/workspace/caiwu-suite-investigation/extracted/payloads-static-readonly/<installer>/`；该绝对路径只在本任务容器有效，跨任务应先读取本目录持久清单，不能假定可直接访问。

完整静态帮助研究包另已生成：15840078字节，SHA256 `b75134e262844f0bee7efde255af26a6541b83e28dd6ce6c314a2ab12649b4ad`，含4HTML文档、472张文档图片、文本及来源哈希。民非与成本的通用2008手册逐文件相同，去重保存。HTML研究副本去掉活动对象并本地化图片链接，原文件未修改。它不是2026运行证据。

跨容器传递边界：Library官方上传助手在tools/list HTTP401，上传未开始，无完整帮助包新Library ID；没有绕过助手上传。已有11截图研究包Library `libfile_442a588c36dc8191bf833338100c9a0e` 仍为版本0。原载荷未上传，不能据本清单声称其他线程已经取得原始PBD/模板内容。需要进一步共享原文件时须由主协调确认确切范围与可用私有传递路径。
