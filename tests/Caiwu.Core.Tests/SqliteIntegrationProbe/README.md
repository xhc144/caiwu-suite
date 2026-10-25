# Core + SQLite 有限集成验证

独立控制台工程，退出码0表示全部断言通过，输出JSON及数据目录中的 `result.json`。它引用真实 Core、真实 `SqliteLedgerStore`，不使用内存store，不加入主solution；父级 Core 单元测试工程已排除本工程源码，仍只依赖 Core/Contracts。

测试对象：Core `c499a4d54c3de86a4e320184541c10313b1c06c2` 与 SQLite `d69a8b7c0c10b1435e45fe8bb275522cb3b49a44`，共享基线 `97d696a3ee7adf100e24b4924438468bd34dd80c`。本轮未发现需修改 Core 或 SQLite 源码的失败；本目录是可选验证工具，不扩展账务功能。

完整集成检出可直接运行：

```bash
dotnet restore tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj \
  --locked-mode --source https://api.nuget.org/v3/index.json
dotnet run --project tests/Caiwu.Core.Tests/SqliteIntegrationProbe/IntegrationProbe.csproj \
  --no-restore --configuration Release
```

没有参数时在系统临时目录创建独立的随机目录；也可在 `--` 后传一个全新目录。账套、备份和恢复文件均为合成测试数据，保留以供独立核对；重用已有账套文件会触发拒绝覆盖。异常会使进程非0退出；数据目录内的 `result.json` 只在全部检查通过后写入。

分离worktree下，通过 `-p:CoreProject=/absolute/Core.csproj` 和 `-p:SqliteProject=/absolute/Sqlite.csproj` 指定真实项目。可用 `-p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-combined-artifacts` 隔离所有生成文件；两个worktree的 Contracts 名称相同且源码哈希一致，本轮使用 `-m:1` 顺序构建。不要把复用旧DLL或静态源码检查当成此次运行结果。

运行范围：

- 企业、小企业分别建账，期初银行借100000/资本贷100000；三凭证为材料10000、费用1200、收入20000，保存→独立审核→记账→查询→月结→关闭重开→在线备份→恢复副本。
- 独立常数断言银行108800、本期借贷各31200、期末借贷各120000；逐行联查原凭证的ID、日期、字、号、摘要和金额。
- 比对重开及备份恢复前后所有DTO字段和列表顺序，含时区/ticks、操作人、状态、期初、附件数、审计、revision和期间锁；恢复副本继续写入时原账和备份保持独立。
- 用独立SQL检查金额是整数分，合计借贷各3120000分，核对原表中的状态、制单/审核人、分录和审计条数。
- 额外的小额账套核对0.1+0.2=0.3及银行父级/明细期末0.7；关闭重开后检查父子汇总、末级总计与明细联查。
- 原生SQLite触发器使真实审计插入失败，确认异常传播且整份快照、revision、所有关系表一起回滚；之后删除测试触发器。
- 两个独立SQLite连接、两个Core服务，经读屏障固定相同revision，竞争保存新凭证；必须1次成功、1次StoreConcurrencyException，编号不重复，revision仅加1。

不覆盖Windows/WPF交互、故障断电、跨进程竞争、SQLite全量压力测试、所有异常路径、完整会计制度/结转/税务报表或生产授权体系。直接 `ILedgerStore.Write` 是可信存储边界，不能当作生产账务修改入口；本轮验证业务路径均经过Core。完整记录见相邻 `INTEGRATION_VALIDATION.md`。
