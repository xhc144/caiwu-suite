# codex/w2-native-voucher-preflight-20261026

状态：仅本地归档草案；批次 02；未发布、未创建归档提交、未删引用。

- 原名称：`codex/w2-native-voucher-preflight-20261026`
- head：`2ba1e8a799f5d1295795a58528cb462445e38c36`
- tree：`874c47eddf786f402a2d61a391e8cdced4073e61`
- 原提交父节点：`4f5b84b6e1a60f6b4cafade7cc50be68528e6435`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/2ba1e8a799f5d1295795a58528cb462445e38c36)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=22，behind_by=121；merge-base=`dfd60a2ad6dc389e3174d0839967e0e13d9fa62b`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 53 条；当前 main 相同 3 条；当前或 main 历史同路径命中 4 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/ledgers/README.md` | `28ba73934b654b8d2c475fc4aee8ea7ceed6de95` | `9230cb6e4a68c5b7dc60414a3d4e87ac0af06e68` | 待行为映射 | — |
| `app/modules/ledgers/e2e/general.spec.ts` | `135456d4194dbbc4bc49d22fe9fa2b0ffe8d36ff` | `6020f052d91846999664c57ceed440b59219ffba` | 待行为映射 | — |
| `app/modules/ledgers/e2e/multicolumn-custom.spec.ts` | `17130b6288a8f2a5d0f47c9ac9f41c86657cab2d` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/e2e/multicolumn.spec.ts` | `0398a2b0873c3e69ae09c7a1492b7f3de80dea75` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/manifest.ts` | `91a9aac2564954f18111bf9f43902ee6eac78ac4` | `7c80641ec8be40514207c2b4e715797815c423e9` | 待行为映射 | — |
| `app/modules/ledgers/multicolumn.ts` | `078a778fa389f9328af7ac78f0ba1031899ceb18` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/server/multicolumn-format.ts` | `758481d1cb1b1bc3729a81363ee607bf34130c5a` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/server/multicolumn.ts` | `5e774c9e26e292f49f2d0f81f1073d6b52b135eb` | `d9631f96e3bd7718d3ff3ba3cdd656650e997148` | 待行为映射 | — |
| `app/modules/ledgers/server/router.ts` | `d8941e38ddcabcfc6ed670fa3363f6934d29e046` | `2cce59201785e3910fd2721f105d0254e402917d` | 待行为映射 | — |
| `app/modules/ledgers/test/general.test.ts` | `b5fd853b4148eda0d0a79b0af2e39469dcb74161` | `ee31aa3afc75fe43ca26904fea13bc8951cbd167` | 待行为映射 | — |
| `app/modules/ledgers/test/multicolumn-custom.test.ts` | `11f70e6a2f8b6347bf88eef7c5fb7d519e7aa4a9` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/test/multicolumn-seed.ts` | `27e8097aa3dd887592e3a14e972927f56d11980b` | `964713fd5d725b29603eae7ef7bd9ff7fa69c4d0` | 待行为映射 | — |
| `app/modules/ledgers/test/multicolumn.test.ts` | `be0d4a2ff8ec5b5e79ed24e6432dbd0e838cd621` | `7bd81c7de14101acdf70f7c3a91a64dbe350cb11` | 待行为映射 | — |
| `app/modules/ledgers/web/MultiColumnPage.tsx` | `08789d03d87adcb7127a556792c94163b7101f99` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/web/MultiFormatDrawer.tsx` | `6510c291aa0e6bacc37e6a806449e87415a5b7b6` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/web/index.tsx` | `ce0aea5522de2c05ba08cbd238f6df48c6eec7cb` | `f0bf2885130a52005d3618415644c59851c6b0e5` | 待行为映射 | — |
| `app/modules/legacy-import/README.md` | `eeb99e34d1837281a2c19893dbc666f8a9fd2daa` | `0d40ea81088af34cb11c8480d0f12eb31f309820` | 待行为映射 | — |
| `app/modules/legacy-import/e2e/import.spec.ts` | `845e9aec9d993ae1e1b80becd32726c70d1e3087` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/e2e/native-preflight.spec.ts` | `fc719bd1724d1ff4783efd07743b5ee930563034` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/manifest.ts` | `3fbf899835b645ce88238bbab6b2fdba2f4ef2b8` | `378662f7a3c67be8e9032c578d1f6f723b068024` | 待行为映射 | — |
| `app/modules/legacy-import/native-sample.ts` | `83e28295458fcb1d5ddbbbfcaf3e0778078bcdbf` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/native.ts` | `4e456479db6f869e6d19de18df6c9bc8576807c5` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/sample.ts` | `9f12c527a6cbf03c72c1c72d1c1c745731b2b507` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/index.ts` | `37a582cdf361c9bdcd47d59c837e024e070e12fe` | `4c68cc2f4e568317885a844b59d5b8f2ac5eaac5` | 待行为映射 | — |
| `app/modules/legacy-import/server/migrations.ts` | `09b4ff4353a6385ed15699ee0ce9b774fe9dbb69` | `cecc1c804614e7a47c2f79d8777ad07159576373` | 待行为映射 | — |
| `app/modules/legacy-import/server/native-preflight.ts` | `4bd707bb93ff65d1a3125df76165c6eea7ad9b81` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/parse.ts` | `8bcc89dd6a39a5356c0f7692db014e56fa081a26` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/plan.ts` | `b49a7b536e86c5b6ae1e7bdb816d68bc920d589b` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/server/router.ts` | `c0a78c7836c04e9b162a2c0a90a0a5941c865512` | `e839c4a8875cfad8d33237705b5756dac064d3f3` | 待行为映射 | — |
| `app/modules/legacy-import/server/service.ts` | `0537588f2d523e1a241a0f267af2e6e5568a8d13` | `47ae80da1ee4b978fa3d5dfe767f04a36e9cb21e` | 待行为映射 | — |
| `app/modules/legacy-import/shared.ts` | `969bb09edf6098a61a482bb182a3fddf339c60ef` | `cca69d433d9cdc18b9d62e1758406091e3f7460a` | 待行为映射 | — |
| `app/modules/legacy-import/test/import.test.ts` | `1472cb197cf1a237e9ee1af8e8252e598f49c94c` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/test/native-preflight.test.ts` | `7c45e04294046a04664f01cadd6d4bf7dd2e2032` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/web/ImportPage.tsx` | `85a3840f3f79e85f6b90e79a1ff8f04abc7823d9` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/web/NativePage.tsx` | `9c008cd6077e68291e4413a5b3962257a0470b27` | `不存在` | 待行为映射 | — |
| `app/modules/legacy-import/web/api.ts` | `91c0fbaa08dc71d611b930216be199a5d71838b7` | `11d79fae7d301f86ace3e242b22fef51eafd5cb9` | 待行为映射 | — |
| `app/modules/legacy-import/web/index.tsx` | `095f39c34472f704586c34f65ff5865191a3f5e6` | `3d52a88e34e67d2b6683da6b345302d968ee3869` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `adcb2e6facd48e150d5e29b45810dddfe62bc9ab` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `5566fe65b14d444bfc8446152433ebd338f684bb` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/formula-options.test.ts` | `202dfa20be15ca6041bda869c0aa8e66926fcbb9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/retrieval.test.ts` | `23a122047374c3b72e12e21ae8b534dc68065992` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/ytd-scope.test.ts` | `b54250dcc071f1b4f356cdd987c503e1328f0bab` | `不存在` | 待行为映射 | — |
| `app/packages/core/README.md` | `14a0ba4ba46c43c9b7af4c896f6e428278f4172f` | `不存在` | 待行为映射 | — |
| `app/packages/core/src/ledger.ts` | `e01324417c4a94bbded00be10119c7951a0d21bc` | `5e1c1e3b69d3c5ddb49dcd2a955432ca767ac72e` | 待行为映射 | — |
| `app/packages/core/src/server/services/ledger.ts` | `eb182636e989fa00549cec726c4d36cfa742e913` | `28abb4aa14fd219a50c868b1e67410c1399f4fc2` | 待行为映射 | — |
| `app/packages/core/src/server/services/vouchers.ts` | `404791fe3ede2cb1da909e345d9ec4931889d211` | `4fa81acaec8ea7567bffe2268d2f66900ea34946` | 待行为映射 | — |
| `app/packages/core/test/ledger-closing.test.ts` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/ledger-ytd-scope.test.ts` | `c5868ec3389bc1a737bcecbf37b1de508648b23b` | `c5868ec3389bc1a737bcecbf37b1de508648b23b` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/voucher-references.test.ts` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/voucher-source-numbering.test.ts` | `b11aab48dc56d5c928bedadfc346f3924f7e0ff6` | `46bb895654c9c50f3574a84aee06f9508e393bda` | 待行为映射 | `f60d98edbd90e438068fd53ebea7cbf6d85dd948` |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `2ba1e8a799f5d1295795a58528cb462445e38c36` 创建引用，并核对 tree `874c47eddf786f402a2d61a391e8cdced4073e61`；本草案不执行恢复。
