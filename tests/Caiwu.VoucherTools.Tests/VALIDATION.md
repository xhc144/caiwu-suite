# 凭证整张复制模块验证

2026-10-25 09:25 UTC，Linux x64，.NET SDK `10.0.402`。仅使用测试中自建的合成账套和内存 CAS store，没有打开真实账套、原安装器或派生 catalog。

## 实际执行

```sh
dotnet build tests/Caiwu.VoucherTools.Tests/Caiwu.VoucherTools.Tests.csproj -c Release --no-restore -warnaserror
dotnet test tests/Caiwu.VoucherTools.Tests/Caiwu.VoucherTools.Tests.csproj -c Release --no-build --no-restore --logger 'trx;LogFileName=voucher-copy-final.trx'
```

在本环境中以上命令通过 `CAIWU_DOTNET_ROOT=/workspace/caiwu/sdk bash tools/dotnet-local.sh` 调用 SDK。Release 构建 **0 警告、0 错误**；测试 **37 通过、0 失败、0 跳过**。原始 TRX 保存在本地被 git 忽略的 `tests/Caiwu.VoucherTools.Tests/TestResults/voucher-copy-final.trx`。

测试依赖沿用项目现有精确版本：`Microsoft.NET.Test.Sdk [18.11.0]`、`xunit.v3.mtp-off [4.0.2]`、`xunit.runner.visualstudio [4.0.1]`，依赖锁文件随模块提交。

## 行为证据

- 使用真实 `LedgerService` 创建、审核、记账合成源凭证，再通过宿主调用保存复制计划。分别验证 Draft/Reviewed/Posted 源都变成不同 ID 的新 Draft，审核人为空、本次制单人正确、只新增一条 SaveDraft 审计，源内容不变，余额未因新草稿重复发生。
- 计划器前后记录 store 读写次数，验证无隐藏读取、写入或保存。取消仅丢弃计划，序列化全快照完全不变。
- 重复行原序保留；逐行验证科目/摘要与 decimal bits 相等。验证 `0.01`、`0.1000`、`92233720368547758.07` 经宿主保存仍精确；另一侧零保留，全零/负数/超精度/越界行明确失败。
- 缺失、停用和非末级科目返回准确行号与错误码，不替换或删除行。缺失/非末级样本是刻意构造的无效合成快照；停用还通过真实 Core 科目变更覆盖。
- 日期跨年、启用月前、已结账目标月、重号、非法编号/凭证字/制单人/附件数被阻断。已结账源凭证可复制到明确指定的开放目标月。
- 用不同账套、相同 revision 验证 Core 拒绝宿主跨账套保存；在计划后停用科目或结账，验证 Core 拒绝旧 token，账套及计划不被更改，没有刷新 token 或自动重试。
- 列表中的源 ID 由同一快照查找，外账选择不存在时拒绝。源数组后续被调用方替换行也不影响已分离计划；计划行集合只读。
- 非规范摘要、双边金额、不平衡、缺行/空行明确失败，未尝试修剪、配平或补齐。

## 集成边界与剩余工作

Contracts/Core 对齐 v1.2 的 `bb76658c19df94ab79e257db076d2ac8a39b7997` / `66621203066488c7e7a4115ede508e88ec58e3fa`。本模块功能为纯复制计划、预检和宿主适配接口；宿主 `SaveDraft` 是唯一真实保存入口。预检不取代 Core 的最终校验。

本次没有改 Desktop、Contracts、Core、SQLite、根 solution 或 CI。Acceptance owner 需按 [集成说明](../../src/Caiwu.VoucherTools/README.md) 在 `codex/windows-revalidation` 加引用和 UI，再执行 Windows 的选择、预览、保存、错误留窗、双击和取消验收。SQLite 真实文件/跨进程验收继续由现有 Core/SQLite 与 Acceptance 任务负责，本模块没有重新实现存储或声称上述宿主交互已完成。
