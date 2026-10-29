# codex/w2-14-report-ui-20261026

状态：仅本地归档草案；批次 04；未发布、未创建归档提交、未删引用。

- 原名称：`codex/w2-14-report-ui-20261026`
- head：`100fdcf71b365cd1ac364f3007911810aea3336b`
- tree：`0f0264633d9fea284a779c1242021a9c9dc5a64c`
- 原提交父节点：`c46aa8a4977287f347d23196b767887617bb974a`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/100fdcf71b365cd1ac364f3007911810aea3336b)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=12，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 34 条；当前 main 相同 2 条；当前或 main 历史同路径命中 3 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/report-engine/README.md` | `5b086ad2e4eb748218076d4ff7dcb4b2fc88b018` | `8b6c5f5d367662bf3cd5ecb47c084ba55c4cc3c9` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/ui/advanced.spec.ts` | `7ee051273519606511e932b0ede20d78920f8929` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/ui/drilldown.spec.ts` | `b5fb39c6c9f1976c9d1df7eaf93af42d8960d2e6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/ui/editor.spec.ts` | `45cc2f00278aa365da377b68ee773d8dba8e2c4d` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/ui/parent-account.spec.ts` | `b20ff553c989d099d21746fa609fb5dcd57a5fa1` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `e93d2029a3fb734f341a23c05d654243d817b35b` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `7a87c625eedd4a3f759872b55480a2bf940e5da5` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/formula-options.test.ts` | `202dfa20be15ca6041bda869c0aa8e66926fcbb9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/retrieval.test.ts` | `5b60393d86912b10f097f628a08f8bdd8ba6a3b5` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/ytd-scope.test.ts` | `b54250dcc071f1b4f356cdd987c503e1328f0bab` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/ui/checks.test.tsx` | `1eef93185043054184a387d7b652d86557b27ee8` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/ui/drilldown.test.ts` | `679fb9a69a53b38165de62969e6024fdf0f3854b` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/ui/generation-range.test.ts` | `406a1194ff567004a3fa2bc18831145d7ee96a51` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/ui/history.test.tsx` | `bbf015eebec2f9ff0a39c19cb2abf2e8aebbfd14` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/ui/paste.test.ts` | `8d36fc7babacb3d6acde186b0495234ee4f45510` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/web/ChecksEditor.tsx` | `857a7e18975757b02ca32d5ae57e346363a662a9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/web/DesignerPage.tsx` | `0d8fec035373260d6852bbd720c17f344b8a2cd2` | `b23c97128341b38213effcd905fe3155cb793eb4` | 待行为映射 | — |
| `app/modules/report-engine/web/FunctionGuide.tsx` | `1aa6f6847710aa49cb4587789448ba77e524b294` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/web/FunctionWizard.tsx` | `30312aab0133e0dd0f60085598c04f41214b7a92` | `591b586be666fbb06750f194c43be6e8aeebfabe` | 待行为映射 | — |
| `app/modules/report-engine/web/PasteDrawer.tsx` | `ec0bc9846051d193ad115585d102f4e36a6cab44` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/web/ViewPage.tsx` | `ea8134b86cea9e0a66430041aa48c8ee03b18308` | `2509f460a6e3198d0619fe98b24009f0a3b0deba` | 待行为映射 | — |
| `app/modules/report-engine/web/drilldown.ts` | `a3661851c44f5c089c11038d33cea40986a0bc0d` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/web/history.ts` | `84e296cb0ee308a0a4b947b5ae9774e199f5c887` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/web/paste.ts` | `813cd14790c80e7bbabdebf79c67204aeb9f3f7e` | `不存在` | 待行为映射 | — |
| `app/packages/core/src/ledger.ts` | `e4df0895dedf7bbe4cab2956a8ab6b032bfa8a3a` | `5e1c1e3b69d3c5ddb49dcd2a955432ca767ac72e` | 待行为映射 | — |
| `app/packages/core/src/server/services/ledger.ts` | `af2970b92455f446d6cb668a39fe6952ddf23798` | `28abb4aa14fd219a50c868b1e67410c1399f4fc2` | 待行为映射 | — |
| `app/packages/core/src/server/services/vouchers.ts` | `404791fe3ede2cb1da909e345d9ec4931889d211` | `4fa81acaec8ea7567bffe2268d2f66900ea34946` | 待行为映射 | — |
| `app/packages/core/test/ledger-closing.test.ts` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/ledger-ytd-scope.test.ts` | `bdb826d41f297c8b3c271eaecb55d5c2fac94626` | `c5868ec3389bc1a737bcecbf37b1de508648b23b` | 待行为映射 | — |
| `app/packages/core/test/voucher-references.test.ts` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/voucher-source-numbering.test.ts` | `b11aab48dc56d5c928bedadfc346f3924f7e0ff6` | `46bb895654c9c50f3574a84aee06f9508e393bda` | 待行为映射 | `f60d98edbd90e438068fd53ebea7cbf6d85dd948` |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `100fdcf71b365cd1ac364f3007911810aea3336b` 创建引用，并核对 tree `0f0264633d9fea284a779c1242021a9c9dc5a64c`；本草案不执行恢复。
