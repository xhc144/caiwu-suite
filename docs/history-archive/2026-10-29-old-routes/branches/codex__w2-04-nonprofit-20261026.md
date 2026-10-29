# codex/w2-04-nonprofit-20261026

状态：仅本地归档草案；批次 05；未发布、未创建归档提交、未删引用。

- 原名称：`codex/w2-04-nonprofit-20261026`
- head：`7388834962dcfa3e96dac5adb37ea6104c8aaa3f`
- tree：`f5b67769dfa586afcf344db7aeb6ce0445ef112e`
- 原提交父节点：`7999494d2f7dcc42c22d8cd910ecef948fff3b99`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/7388834962dcfa3e96dac5adb37ea6104c8aaa3f)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=11，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 37 条；当前 main 相同 2 条；当前或 main 历史同路径命中 3 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/report-engine/e2e/nonprofit/balance-sheet.spec.ts` | `e20b5ca4e5f3fea3a10928515b64b14fbb9362bd` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/cashflow.spec.ts` | `8c92c144c4e7c01d2d115ce24e01ea59e72e87b7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/fixture.ts` | `c7738847110d6b615fcd0fd52e4785f8e904c12c` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/shared-options.spec.ts` | `0e8cbefcd21db9009071909237ec9a93860ce520` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `e93d2029a3fb734f341a23c05d654243d817b35b` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `7a87c625eedd4a3f759872b55480a2bf940e5da5` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/README.md` | `9fcddb6ec58740a38399cc50684135afae1f2ea8` | `77038c1eec61d8fe2df13a540367403dabb9fca7` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/activity-totals.ts` | `12fb28e8721f871ae79fcde63ec1b6805168de2a` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/balance-sheet.ts` | `c9010a9d6bb7c9a8a69efc8e020abbda198c519e` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/cashflow-comparative.ts` | `53ad83ff601baea6d7cd33968c1e77b92bc54839` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/cashflow.ts` | `4edf95357806ddbf0e5ba23f4d0edd570dae4b53` | `26cb4c6c8d503906846e0771812988e02aaebf56` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/forms.ts` | `66272cbd68edf7a23ae886f730853eb48e06010c` | `251e8d2448b1eba3d47672d08e8505f90a9d2292` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/period-formulas.ts` | `c69c2494ee59508e11a5b87faf6856aae624f57f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/restriction-evidence.ts` | `68667a78dea5d586ad9e46e5fce6be7f26528e64` | `3f7bc139deccef22606a58bf2595c20576d4ede7` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-fixture.ts` | `b53dee15990d96a4c8ae13bed6e42d04d3705b19` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-totals.test.ts` | `894ba46939c843e6e804dd8012553e4f480b14be` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/balance-fixture.ts` | `22359caab5455fc0bbf565509359d2ae41ef65ef` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/balance-sheet.test.ts` | `2f6bcb1050b41247c6559a66fffb4cb38f9cc8ac` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/cashflow-comparative.test.ts` | `c523c8784f7c5129d5b7316265ddc2e78455d9c6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/evidence-fixture.ts` | `1df89ca6bad5de663a8d084af15632178dae5c30` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/fixture.ts` | `1d02d1d0771a164f12bb885167e263677fb1fc3f` | `55a551c427811f59418cebde9808276dbc53418f` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/golden.test.ts` | `57fb8835cbd08e7a580a8442e342a1ce8a4e336a` | `794e20e71f7b709dd27f8c9f93afe216f35f9c6a` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/reports.test.ts` | `941e6e716d8b612d2fd8c7582d60ee5de2ec6d75` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/restriction-evidence.test.ts` | `ba080c0651ece415786cb4fd3431c2fd432c54b6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/formula-options.test.ts` | `202dfa20be15ca6041bda869c0aa8e66926fcbb9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/retrieval.test.ts` | `5b60393d86912b10f097f628a08f8bdd8ba6a3b5` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/ytd-scope.test.ts` | `b54250dcc071f1b4f356cdd987c503e1328f0bab` | `不存在` | 待行为映射 | — |
| `app/packages/core/src/ledger.ts` | `e4df0895dedf7bbe4cab2956a8ab6b032bfa8a3a` | `5e1c1e3b69d3c5ddb49dcd2a955432ca767ac72e` | 待行为映射 | — |
| `app/packages/core/src/server/services/ledger.ts` | `af2970b92455f446d6cb668a39fe6952ddf23798` | `28abb4aa14fd219a50c868b1e67410c1399f4fc2` | 待行为映射 | — |
| `app/packages/core/src/server/services/vouchers.ts` | `404791fe3ede2cb1da909e345d9ec4931889d211` | `4fa81acaec8ea7567bffe2268d2f66900ea34946` | 待行为映射 | — |
| `app/packages/core/test/ledger-closing.test.ts` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/ledger-ytd-scope.test.ts` | `bdb826d41f297c8b3c271eaecb55d5c2fac94626` | `c5868ec3389bc1a737bcecbf37b1de508648b23b` | 待行为映射 | — |
| `app/packages/core/test/voucher-references.test.ts` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/voucher-source-numbering.test.ts` | `b11aab48dc56d5c928bedadfc346f3924f7e0ff6` | `46bb895654c9c50f3574a84aee06f9508e393bda` | 待行为映射 | `f60d98edbd90e438068fd53ebea7cbf6d85dd948` |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `7388834962dcfa3e96dac5adb37ea6104c8aaa3f` 创建引用，并核对 tree `f5b67769dfa586afcf344db7aeb6ce0445ef112e`；本草案不执行恢复。
