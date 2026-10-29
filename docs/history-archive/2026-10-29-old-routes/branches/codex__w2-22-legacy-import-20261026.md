# codex/w2-22-legacy-import-20261026

状态：仅本地归档草案；批次 06；未发布、未创建归档提交、未删引用。

- 原名称：`codex/w2-22-legacy-import-20261026`
- head：`e682c8bb60e85b87836828df7931722eb9992ce0`
- tree：`9973169839c8e4f0eeebdaec7e797b35a48fbc9f`
- 原提交父节点：`5d6f6d57214407144fda3bd0a00decdf74872219`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/e682c8bb60e85b87836828df7931722eb9992ce0)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=8，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 30 条；当前 main 相同 2 条；当前或 main 历史同路径命中 3 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/legacy-import/README.md` | `0d93faaa5aa3a7caa216e71c65d430f3a65fef2a` | `0d40ea81088af34cb11c8480d0f12eb31f309820` | 待行为映射 | — |
| `app/modules/legacy-import/e2e/import.spec.ts` | `845e9aec9d993ae1e1b80becd32726c70d1e3087` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/manifest.ts` | `90b8fc3833cb6bf1f124d0a5489610f07c737d36` | `378662f7a3c67be8e9032c578d1f6f723b068024` | 待行为映射 | — |
| `app/modules/legacy-import/sample.ts` | `9f12c527a6cbf03c72c1c72d1c1c745731b2b507` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/index.ts` | `37a582cdf361c9bdcd47d59c837e024e070e12fe` | `4c68cc2f4e568317885a844b59d5b8f2ac5eaac5` | 待行为映射 | — |
| `app/modules/legacy-import/server/migrations.ts` | `09b4ff4353a6385ed15699ee0ce9b774fe9dbb69` | `cecc1c804614e7a47c2f79d8777ad07159576373` | 待行为映射 | — |
| `app/modules/legacy-import/server/parse.ts` | `8bcc89dd6a39a5356c0f7692db014e56fa081a26` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/plan.ts` | `b49a7b536e86c5b6ae1e7bdb816d68bc920d589b` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/router.ts` | `964284ed646d3f5deb46f31970cc3a5bfd79b8a6` | `e839c4a8875cfad8d33237705b5756dac064d3f3` | 待行为映射 | — |
| `app/modules/legacy-import/server/service.ts` | `0537588f2d523e1a241a0f267af2e6e5568a8d13` | `47ae80da1ee4b978fa3d5dfe767f04a36e9cb21e` | 待行为映射 | — |
| `app/modules/legacy-import/shared.ts` | `969bb09edf6098a61a482bb182a3fddf339c60ef` | `cca69d433d9cdc18b9d62e1758406091e3f7460a` | 待行为映射 | — |
| `app/modules/legacy-import/test/import.test.ts` | `1472cb197cf1a237e9ee1af8e8252e598f49c94c` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/web/ImportPage.tsx` | `85a3840f3f79e85f6b90e79a1ff8f04abc7823d9` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/web/api.ts` | `91c0fbaa08dc71d611b930216be199a5d71838b7` | `11d79fae7d301f86ace3e242b22fef51eafd5cb9` | 待行为映射 | — |
| `app/modules/legacy-import/web/index.tsx` | `8361828547a065040f87dd4baa8224d63998abdb` | `3d52a88e34e67d2b6683da6b345302d968ee3869` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `e93d2029a3fb734f341a23c05d654243d817b35b` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `7a87c625eedd4a3f759872b55480a2bf940e5da5` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
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

未来若需恢复引用，在另行授权后以原名称和 head `e682c8bb60e85b87836828df7931722eb9992ce0` 创建引用，并核对 tree `9973169839c8e4f0eeebdaec7e797b35a48fbc9f`；本草案不执行恢复。
