# Core P1定点返修证据（2026-10-25）

起点：Core分支 `0bc92aca68677fb7e3cb88d4be49167c51f1a680`；独立验收源码提交 `2c1d697bfd60548a72674db0359e0b66138d2db6`（PR8），其被验收生产基线为 `037a07585078d4dfcd443a2cc4a237c88aed07a0`。本轮只修ACC-003期初处理，不改Contracts/UI/SQLite，不扩展Costing。

## 重现与实际修复结果

使用验收提交的 Regression/Program.cs 原样，以及该提交的真实 Desktop `Presentation/LedgerSession.cs`、`EntryModels.cs`，临时控制台工程直接引用本分支Core及SQLite `d69a8b7` 的真实项目。所有生成文件放 `/tmp/caiwu-core-p1-artifacts`。这是后端/session/model实测，没有执行WPF。

| 同一套18项独立回归 | 返修前 | 仅期初返修后 |
|---|---|---|
| 总结果 | 14 PASS / 4 FAIL，退出1 | 15 PASS / 3 FAIL，退出1 |
| ACC-002：旧草稿覆盖 | FAIL：20被旧值10覆盖，revision3 | FAIL：待Contracts的编辑token |
| ACC-003：停用零余额行提交期初 | FAIL：不能使用停用科目 | **PASS**：100.01借/贷成功落盘 |
| ACC-004：金额格式 | FAIL | FAIL：保留验收的原UI模型 |
| ACC-005：SQLite busy捕获分类 | FAIL | FAIL：保留验收的原UI捕获分类 |

其余14项原通过用例继续通过。原始输出已保存为 [independent-before.json](independent-before.json) 和 [independent-after-opening-fix.json](independent-after-opening-fix.json)。后两项不代表主协调最新UI修复失败，因为此处刻意冻结在验收提交的UI模型/分类。不能把15/18说成全验收通过。

本次额外增加的4个正向/防丢失用例（其中一个两行Theory）在修复前先执行筛选：**0通过/4失败**。三个失败是停用零/非零余额行不能提交；另一个实际暴露原逻辑会在遗漏停用非零行时静默清零，即使替代后的借贷仍平衡。修复后运行整个Core单测：**58通过、0失败、0跳过**，含新增5个用例和原53个。

## 本次期初规则

- 停用末级允许提交与现值相同的期初（包括零），用于保存完整可见表格。
- 停用科目不允许新增、改值或清除期初；若要修改，先启用科目。
- 停用科目已有非零期初时遗漏该行，整次拒绝；不将它当作整体替换中的隐式清零。
- 非末级、未知/重复科目、非法精度、不平衡、已记账或已结账的拒绝规则保留。
- `RequireUsableLeaf` 和分录验证没有改动；新凭证、审核/记账重新校验停用科目的规则仍通过原回归。

这比“过滤停用科目”保留了历史余额，也没有把停用科目开放给新分录。

## 实际命令

沿用本项目VALIDATION.md中官方SDK10.0.402/runtime10.0.13和可写XDG/NuGet环境。新增筛选的返修前结果TRX为 `/tmp/caiwu-core-p1-regression/core-p1-before.trx`；最终Core命令：

```bash
/tmp/caiwu-dotnet-10/dotnet test tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true \
  --logger 'trx;LogFileName=core-p1-fixed.trx' --results-directory /tmp/caiwu-core-p1-regression
```

退出0。TRX计数已解析：total/executed/passed=58，failed/error/timeout/aborted/notExecuted/warning=0。

临时独立工程在修复前后均按相同命令重新编译（0警告0错误），再运行同一验收源码：

```bash
/tmp/caiwu-dotnet-10/dotnet build /tmp/caiwu-core-p1-regression/Repro.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true -m:1 \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-core-p1-artifacts
/tmp/caiwu-dotnet-10/dotnet /tmp/caiwu-core-p1-artifacts/bin/Repro/release/Repro.dll \
  /tmp/caiwu-core-p1-regression/after.json
```

该Repro工程的全部来源是：本分支 `src/Caiwu.Core/Caiwu.Core.csproj`；SQLite d69a8b7的 `src/Caiwu.Persistence.Sqlite/Caiwu.Persistence.Sqlite.csproj`；验收2c1d697的 `tests/Caiwu.Acceptance/Regression/Program.cs`、`src/Caiwu.Desktop/Presentation/LedgerSession.cs`、`src/Caiwu.Desktop/Presentation/EntryModels.cs`。没有修改这些外部源码，仅用ProjectReference/Compile Link组合。

## ACC-002明确未修复

最小兼容契约建议见 [EDIT_TOKEN_PROPOSAL.md](../EDIT_TOKEN_PROPOSAL.md)：保持SaveDraft签名和位置构造参数，新增 `LedgerEditToken(BookId,Revision)` 的非位置属性；已有Id缺token/过期均fail closed；token必须与打开时凭证同源，并保留提交后的正确版本。此方案仍待主协调独占Contracts定稿，本轮不使用服务缓存或其他绕过方式假装修复。

其后需实际两个SQLite连接及两个WPF编辑窗口重验ACC-002。此处未执行Windows窗口、键盘/IME或错误时表单保留。没有权限拒绝；当前剩余依赖是主协调的Contracts接口决定及相应UI接线。
