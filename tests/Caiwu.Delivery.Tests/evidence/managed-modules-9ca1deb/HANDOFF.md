# 受管模块数据交接

2026-10-25 UTC；私有 `xhc144/caiwu-suite`，分支 `codex/managed-module-data`，草稿 PR28，base `codex/sprint-integration-2`。实现固定提交：`9ca1deb40f9215817a0433572460183d3ba82566`。证据提交仅新增本目录；报告 `sourceCommit` 均为该实现 SHA。

## 可立即集成的结果

- `ManagedDataSession`：复用原 install/data 租约和路径验证，BookId+实际路径映射稳定 InstanceId，提供真实跨线程操作引用令牌、模块路径、附件登记、账套清单同步。没有默认外部路径。
- `ManagedModuleHost` / `Modules`：真实 Summary 首次初始化/已登记打开工厂，四模块原生 API 适配器；FeatureWiring 所需三个委托都有具体可调用方法，详细接法在 `packaging-next/src/Caiwu.Delivery/MANAGED_MODULES.md`。
- `ManagedBookBackup`：一致性 SQLite 副本、所有附件 token 前后复核、默认3次/最大5次、完整 manifest/hash、新实例恢复和失败保留。所有源 hash 都避免直接 fingerprint live WAL 主文件；严格 payload hash 和既有 FileSha256Basis 无放宽。
- 原 `BookOperations.Backup` 对模块登记账套拒绝不完整单文件备份。安装升级可传原生 codecs，先保存完整模块 bundle；缺 codec/附件/孤儿模块时不激活。卸载保留所有用户数据。
- 全局 Operators 使用原模块实时管理授权独立备份，只恢复至新身份目录；不替换现用账户、密码、状态或会话。

## 当前直接证据

- success：固定 SDK10.0.402 官方下载SHA512与仓库元数据一致。`build.log` 为本实现的 Release locked build，0 warning/0 error。
- success：`delivery.json`：166总项，163通过，0失败，3项因本机非Windows而跳过。19项新增受管边界包含真实子进程自持租约、路径/身份、缺失/冲突/损坏/未知/逃逸、重试上限、失败清理、升级拒绝与正向完整bundle、卸载保留；不是只验证编译或计数。
- success：`module-integration.json` 为固定作者源真实 API 合成闭环：账套+摘要+分类+工作表+模板写入，备份，源继续修改，新位置恢复，逐项内容/版本/hash。只读有效备份可恢复，stale分类拒绝。
- success：明确复核根补充边界：同 BookId **且同 Revision** 的两个物理账套选择不同可写摘要路径；编辑恢复副本不改源摘要，恢复不改四类源附件或已经存在的全局 Operators。没有偷偷换 BookId。
- success：虚构身份下，非管理员/已注销管理员不能导出或恢复身份；单账套恢复不覆盖全局密码/启停状态；独立授权恢复可保留虚构 actor/password。
- 所有报告只含合成断言、平台与源码 SHA；没有保存账套、密码哈希、原软件字节、真实窗口、SQL/对象目录或派生 catalog。

精确命令：

```sh
GITHUB_SHA=9ca1deb40f9215817a0433572460183d3ba82566 ./tools/dotnet-local.sh build tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj -c Release -p:RestoreLockedMode=true
GITHUB_SHA=9ca1deb40f9215817a0433572460183d3ba82566 ./tools/dotnet-local.sh run --project tests/Caiwu.Delivery.Tests -c Release --no-build -- report.json
GITHUB_SHA=9ca1deb40f9215817a0433572460183d3ba82566 tests/Caiwu.Delivery.Tests/validate-modules.sh
```

实际组合构建目录：`/tmp/caiwu-managed-validation-wI5RhhId`；正常模块测试的临时用户数据根已自行删除。新 launcher 探针第一次从脚本换为复制 apphost 时漏了子模式参数，导致测试自己递归；仅停止该合成测试进程树并修正参数后，固定提交中的真实独立进程用例通过。没有生产代码失败、用户账套访问或权限拒绝。

## 剩余工作与状态

- pending，非拒绝：根/入口 owner 采纳四业务模块及 ReportDesigner，给 Desktop 添加 Modules 引用，按接线文档正式登记账套并供给 FeatureWiring options。新启动模式必须由实际 WPF 在首个数据访问前调用 `ManagedDesktopLaunch.OpenSession`，验证运行路径属于激活版本。现默认 launcher 仍持父进程锁，不能在其子进程重复取得同名租约。
- pending，非拒绝：根把新 codecs 重载接到实际升级 helper/安装调用；当前独立 helper CLI 无业务模块依赖，模块账套会保守拒绝升级。没有擅改原安装器目录或解除 ManagedDataContract/交付暂停门槛。
- unverified：本机Linux，未执行Windows/WPF、NTFS junction/ACL/硬链接别名、Windows原子发布并发、真实断电、安装快捷方式/打印。Linux真实子进程证明自己的租约交接，不冒充Windows已验。
- 已知边界：账套登记的两个JSON文件不声称跨文件事务，失败保留原件并提供显式清单同步；备份为每本账套的稳定版本捕获，不声称多账套与全局身份的全局原子事务。信任回执/目录权限仍为宿主职责。

没有尚待重试的远端动作、自动审批拒绝或不确定写入。未合main、未改私有权限、未生成凭据、未发布安装包、未上传原软件派生资料。
