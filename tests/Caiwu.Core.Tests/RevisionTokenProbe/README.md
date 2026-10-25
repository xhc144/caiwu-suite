# ACC-002编辑token独立定点回归

更新：Core现已按v1.1强制校验两个token。在基于34f065b集成契约的修复源码上，**同一13项真实SQLite探针全部通过**，原先8个失败全部转PASS；store CAS间隙用例继续通过。[新结果](result-token-enforced.json)及完整返修命令见 [TOKEN_ENFORCEMENT.md](../AcceptanceRepair/TOKEN_ENFORCEMENT.md)。下文保留0377/0d2/34f的修复前证据，不表示当前修复后的状态。

2026-10-25。这里只补测试与证据，未修改Contracts、生产Core、SQLite或UI。主协调决定强制检查代码的改动归属后再实施，避免同时改同一SaveDraft点。

最终复核远端又推进到 `34f065b6028ebd2102f0520263bae8bd3b7ec09f`。该SHA已集成ACC-003，且Desktop的EditVoucher已从同一次fresh snapshot取得数据/revision，编辑器保存也传入了 `_baseRevision` / `_book.Id`（仅静态核对，未跑WPF）。但是Core的SaveDraft仍未读取两个token。**同一仓库内13项探针针对34f065b重新restore/build/run，仍5通过/8失败，退出1，0编译警告/错误**：[result-34f.json](result-34f.json)。以下0d2/0377为较早冻结证据；最终结论应以34f这次复核为准，不能再说该最终SHA的UI未接线。

## 读取到的实际提交

- 首次远端HEAD：`0377ce764bc5a191c232c3f50da602a5ca2c0c0c`。它新增 `VoucherDraft.ExpectedRevision`、契约说明及暂停分发配置，**没有修改Core.SaveDraft或编辑器**。`git grep ExpectedRevision` 在生产源码中仅命中Contracts。
- 检查期间远端更新为 `0d2ae9e379b02c2d86bbd174f56dcd437f910206`，新增 `ExpectedBookId`，仍然没有修改生产Core/UI。当前Program.cs专门按这个含两个字段的契约编译。
- `docs/contracts-v1.1-draft-edit-token.md` 明确：已有Id必须同时提供两个token并匹配；提供token的新建也应匹配；后续store.Write CAS保留。Core owner负责强制规则及回归，Desktop owner负责同快照取数据/token、传递、错误保留输入；Contracts及BookId定义由主协调负责，SQLite/schema无需改变。
- 上述两个SHA都尚未集成Core owner的ACC-003提交3643bcc，不能据这个HEAD否定该期初修复已在独立分支通过。

## 实际结果

均在.NET SDK10.0.402/runtime10.0.13、Debian13 x64上，直接ProjectReference各不可变目标检出中的真实Core、Contracts、SQLite；所有数据库为隔离临时合成文件，结束后删除。构建0警告0错误。没有模拟StoreConcurrencyException。

| 用例 | 0d2ae9e实际结果 |
|---|---|
| 编辑时捕获的正确revision/BookId，保存20 | PASS |
| A、B两个真实连接均在revision1打开；A改20，B用旧revision1/原BookId保存10 | **FAIL：保存成功，20被10覆盖，revision3** |
| 已有Id缺revision | FAIL：仍保存成功 |
| 已有Id未来revision | FAIL：仍保存成功 |
| 已有Id负revision | FAIL：仍保存成功 |
| 成功后仅使用已接受版本+1再次保存30 | PASS |
| 兼容旧的无token新建 | PASS |
| 两token均正确的新建 | PASS |
| 新建带错误revision | FAIL：仍保存成功 |
| Read与Write之间另一个真实连接提交，必须保留底层CAS | PASS：冲突且保留另一方20/两条审计 |
| 已有Id缺BookId | FAIL：仍保存成功 |
| 两本不同账套具有相同revision，提交另一本的BookId | FAIL：仍保存成功 |
| 新建带错误BookId | FAIL：仍保存成功 |

合计 **13项：5通过/8失败，程序退出1**。原始结果：[result-0d2.json](result-0d2.json)。正例能保存及底层CAS通过，不说明编辑token被检查。缺陷原因仍是当前SaveDraft完全不读取这两个字段，而非SQLite的CAS失效。

仓库内最终Program再次编译、运行得到同样13项结果，0警告0错误。加入独立程序的Compile排除后，本Core分支旧契约单测实际回归58通过/0失败/0跳过，TRX为 `/tmp/caiwu-core-p1-regression/core-after-token-probe.trx`；这只是证明新增探针不混入原程序集，不是对新token规则的通过结论。后续实现Core强制规则时，旧正向编辑夹具也须从其加载快照显式传入两个token；不可在通用Save包装器中补读当前revision让测试假绿。

较早0377ce7的10项回归结果为5通过/5失败：[result-0377.json](result-0377.json)。当时仅有ExpectedRevision；当前Program增加了BookId的三个用例并要求新契约，不能原样编译到0377ce7。两个结果按不同冻结SHA分别记录，未混作一次运行。

## 防止测试掩盖旧草稿

`From(loadedSnapshot, amount)`只从已取得的同一snapshot取Id/Number/Revision/BookId。旧窗口用例先固定A/B输入，然后才由A保存20，B绝不刷新版本，也不在SaveDraft包装器中自动补当前revision。冲突用例还要求落盘快照/审计不改变。另一个ReadHookStore故意在一次Read返回前由另一连接提交，用来独立检查验证后store CAS仍有效。

## 复用命令

完整集成检出可用默认项目路径；本Core分支仍保留旧契约，必须通过CaiwuSourceRoot指向含新契约的目标检出，不能把分支自身的58项旧契约单测当作token验收。主Core单元测试排除了这个独立控制台源码。

```bash
# 先设本项目VALIDATION.md中的可写XDG/NuGet环境和官方SDK路径。
/tmp/caiwu-dotnet-10/dotnet restore tests/Caiwu.Core.Tests/RevisionTokenProbe/TokenProbe.csproj \
  --locked-mode --source https://api.nuget.org/v3/index.json \
  -p:CaiwuSourceRoot=/workspace/caiwu-core-acc002-0d2 \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-acc002-token-artifacts
/tmp/caiwu-dotnet-10/dotnet build tests/Caiwu.Core.Tests/RevisionTokenProbe/TokenProbe.csproj \
  --no-restore --configuration Release -p:TreatWarningsAsErrors=true -m:1 \
  -p:CaiwuSourceRoot=/workspace/caiwu-core-acc002-0d2 \
  -p:UseArtifactsOutput=true -p:ArtifactsPath=/tmp/caiwu-acc002-token-artifacts
CAIWU_TOKEN_TARGET_COMMIT=0d2ae9e379b02c2d86bbd174f56dcd437f910206 \
  /tmp/caiwu-dotnet-10/dotnet /tmp/caiwu-acc002-token-artifacts/bin/TokenProbe/release/TokenProbe.dll \
  /tmp/caiwu-acc002-token-probe/result-0d2.json
```

运行时必须传输出JSON的完整路径，父目录需存在。环境中的目标SHA仅作来源记录，不影响测试或绕过检查。后续针对修复后的不可变SHA重建、运行，才可改变本缺陷状态。未执行Windows/WPF双窗口、实际编辑器处理器、输入保留或打包分发验收；当前仍应保留分发暂停。

复核34f时，上述三条命令的CaiwuSourceRoot改为 `/workspace/caiwu-core-acc002-34f`，来源变量设为完整34f SHA，输出文件为 `/tmp/caiwu-acc002-token-probe/result-34f.json`；其余命令和仓库内Program.cs完全相同。此增量只有测试/结果记录，不与主协调并行修改生产SaveDraft。
