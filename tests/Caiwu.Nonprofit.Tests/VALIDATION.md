# 民非建议服务实际测试

2026-10-25，在 Linux、.NET SDK **10.0.402** 上实际执行 Release 测试：**65 通过，0 失败，0 跳过**。项目仅引用 `Caiwu.Nonprofit`，不引用 Core、Contracts、SQLite 或桌面项目；不修改根 solution。

```bash
source /tmp/caiwu-dotnet-env.sh
dotnet restore tests/Caiwu.Nonprofit.Tests/Caiwu.Nonprofit.Tests.csproj --locked-mode
dotnet test tests/Caiwu.Nonprofit.Tests/Caiwu.Nonprofit.Tests.csproj \
  -c Release --no-restore \
  --logger 'trx;LogFileName=nonprofit-release.trx' \
  --results-directory /tmp/caiwu-nonprofit-tests
```

本次 TRX：`/tmp/caiwu-nonprofit-tests/nonprofit-release.trx`。测试包固定并随附 `packages.lock.json`：`Microsoft.NET.Test.Sdk 18.11.0`、`xunit.v3.mtp-off 4.0.2`、`xunit.runner.visualstudio 4.0.1`。

最终TRX独立回读计数：total/executed/passed均65，failed/error/timeout/aborted/notExecuted均0；SHA256 `892491534acd4a37ffba4eea3e384274d5019488fd515320e25e187463426327`。安装了与根global.json一致且经官方SHA512核验的SDK10.0.402，遥测及ASP.NET证书生成关闭，工具/包缓存均隔离在/tmp；SDK和缓存不随项目提交。已有.NET10.0.402环境可直接执行上面的restore/test命令，无需本次临时环境脚本。

## 证据与覆盖

`OfficialScenarioTests` 将既有27个独立手算 JSON 案例转换为真实服务调用：首笔 Opening 建立期初快照，其余凭证逐笔调用 `Propose`；独立分配案例调用 `ComputeAllocation`。6个正例比较预先写定的收入费用、现金、两类净资产和分配结果；21个反例比较拒绝代码。没有把 JSON Schema 通过当作服务已实现。

固定样例为：限定和非限定捐赠各1000、支出200后相应净资产800；共同费用1000按经人工批准的3:2依据分配600/400，期末限定/非限定净资产3600/2400；101分等分为34/34/33；解除A300但保留B700；可靠凭据的非现金服务捐赠收入与费用各1000而现金和净资产变动为零。

其余38个实际用例覆盖所有生成入口、限定性费用结转、完整与部分结转阶段、解除权限、可靠服务捐赠前提、整数分及大权重分配、0.1+0.2、金额精度和范围、稳定ID、重复请求及ID冲突、过期版本、期间锁/跨期、规则绑定、限制版本/项目/外部证据、输入不变与待人工复核状态、未支持的前期调整、规划版本耗尽、9999年12月月末日期边界，以及以下审查修复：

- 1分分给两个受益行时，零份额留在两行分配底稿中，但凭证仅保留正金额费用行及银行行；拒绝插入零金额凭证行。
- 原始服务捐赠分录按实际现金科目判断非现金性质，不能通过清除显示标记绕过计量可靠性检查。
- 捐赠与费用混合业务不能靠添加互相抵销的银行或固定资产分录绕过人工复核；混合现金业务明确拒绝，非现金业务仍要求可靠计量。这是本建议服务的保守支持边界，不是断言所有捐赠与费用组合依法都属于服务捐赠。
- 已有月底投影不能生成月初解除建议；`LastPlannedDate` 保留时间先后关系。
- 含 `|` 的限制ID与项目组合不会碰撞生成相同结转凭证或分录ID。
- 建议保留可序列化的服务/解除类型化评估及可读证据引用；纯分配可暂不绑定凭证，生成费用建议必须有凭证ID。

本次引用文件 SHA256：

- `rules/scenarios/nonprofit-v2.json`：`1463f94edd5ad6c6017f162085aa190805c475f66770ecb6ad0717e7e7e2ff47`
- `rules/packages/nonprofit.json`：`0730548fdc4cd1db74f587ba050c2fd8849b32804e50c9eefa1394c561d3a4df`

## 限制

测试验证的是独立建议服务和假想状态投影。所有资料与金额均为合成；测试不生成真实凭证，不进行持久化、审核、记账或期间关闭，也未验证桌面交互、完整报表或旧账迁移。实际捐赠确认、限制事实、分配合理性及计量可靠性仍需专业人员判断；通过这些测试不构成真实财务合规保证。
