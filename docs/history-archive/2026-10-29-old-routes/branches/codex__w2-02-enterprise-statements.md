# codex/w2-02-enterprise-statements

状态：仅本地归档草案；批次 04；未发布、未创建归档提交、未删引用。

- 原名称：`codex/w2-02-enterprise-statements`
- head：`91e8e30435923db730881c9fa765f883364d2028`
- tree：`c8ea82a8145d42872178369c0a9a42ee6991c6e7`
- 原提交父节点：`ce7af22ea872ce44fb290d1754e01063ca4a723a`, `a8eb1c0b12e2f9931ae2da3f135f6ceee0bcc826`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/91e8e30435923db730881c9fa765f883364d2028)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=10，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 30 条；当前 main 相同 3 条；当前或 main 历史同路径命中 4 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/report-engine/e2e/enterprise/fixture.ts` | `be8871b1442b09f2dca92d2cc60775718d5cad50` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/period-slice.spec.ts` | `2407247fb1dd4c0d9e50be7bc76171fbd51984e1` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/statements.spec.ts` | `46b2177e0c7ed897f050477461d21aae3b3b651a` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `e93d2029a3fb734f341a23c05d654243d817b35b` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `7a87c625eedd4a3f759872b55480a2bf940e5da5` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/201.json` | `0f538bbeb2f8466424fc8a2a9d36fc7772bdabab` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/202.json` | `c7e0cd7328a1d09ff858978ce6434bf0a172e38d` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/203.json` | `7960484c6b1a5c05b980e0e513a010080b44f528` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/README.md` | `88ee1c931039786a85232291962247b6c317cd88` | `33957300808b9d27bad97a3dd28f339a9ec5c779` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/index.ts` | `9e7fac4d4e549747da644dd7563b2cb84ba9fba2` | `9fc900fef0fda11525a4126ff383922f0a04b33f` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/lines.ts` | `8d310ba9b1ceef51700489a569dff13985e18f30` | `8d310ba9b1ceef51700489a569dff13985e18f30` | 相同 | `4f9479106e4ab189eb08cec0ce4befd2ab96534f` |
| `app/modules/report-engine/templates/enterprise/period-slice.ts` | `8282f88cce7491243822d7e1f716448c14ab2777` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/fixture.ts` | `bb6b526b99e928638f81237eea1ff4220f9f11a8` | `c6a772c17dbb343c831392d3dd7492cb1d5dca64` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/mapping.test.ts` | `eda4b9b5c627fe662f0183b9923455c24f36eed3` | `79b4620f502ed5fa2e33be7563ab7a3cd854a7f9` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/period-fixture.ts` | `7b7fa4d06281abef7063ec6f5f3625d33c1783bd` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/period-slice.test.ts` | `9ee40b0cb7cffe0266033f0ec5075f9d522c6c94` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/statements.test.ts` | `c85ba084959a261a5e7a7d933b392d1e213571e5` | `不存在` | 待行为映射 | — |
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

未来若需恢复引用，在另行授权后以原名称和 head `91e8e30435923db730881c9fa765f883364d2028` 创建引用，并核对 tree `c8ea82a8145d42872178369c0a9a42ee6991c6e7`；本草案不执行恢复。
