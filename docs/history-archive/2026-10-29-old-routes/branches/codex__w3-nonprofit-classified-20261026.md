# codex/w3-nonprofit-classified-20261026

状态：仅本地归档草案；批次 05；未发布、未创建归档提交、未删引用。

- 原名称：`codex/w3-nonprofit-classified-20261026`
- head：`bbc44a65dfbaef81fc948b1a7f9fcba9d8b07790`
- tree：`34e4e7655b02840e4971ec8b1ad36c7a49454597`
- 原提交父节点：`c7e9b1c747404556e47d6f09590b61f1c54d80c0`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/bbc44a65dfbaef81fc948b1a7f9fcba9d8b07790)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=23，behind_by=121；merge-base=`dfd60a2ad6dc389e3174d0839967e0e13d9fa62b`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 58 条；当前 main 相同 3 条；当前或 main 历史同路径命中 4 条。不同 blob 的业务意义尚未审结。

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
| `app/modules/report-engine/e2e/nonprofit/activity-classified.spec.ts` | `25c12878ef69403d0f31a9e266b98db0bf6cf0c7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/balance-sheet.spec.ts` | `e20b5ca4e5f3fea3a10928515b64b14fbb9362bd` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/cashflow.spec.ts` | `8c92c144c4e7c01d2d115ce24e01ea59e72e87b7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/fixture.ts` | `66ee1285b563b71e0ea9d01b4e8409e449882bd4` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/shared-options.spec.ts` | `0e8cbefcd21db9009071909237ec9a93860ce520` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `adcb2e6facd48e150d5e29b45810dddfe62bc9ab` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `5566fe65b14d444bfc8446152433ebd338f684bb` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/README.md` | `e987094d32f162d6a6f1e5e0d653ffbe0c0b29ec` | `77038c1eec61d8fe2df13a540367403dabb9fca7` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/activity-classified.ts` | `781727142bf9968918586d84e162ed8c737c56c6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/activity-totals.ts` | `b96e73726c0fb4204e7359bac273a202e3d3708c` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/balance-sheet.ts` | `c9010a9d6bb7c9a8a69efc8e020abbda198c519e` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/cashflow-comparative.ts` | `53ad83ff601baea6d7cd33968c1e77b92bc54839` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/cashflow.ts` | `4edf95357806ddbf0e5ba23f4d0edd570dae4b53` | `26cb4c6c8d503906846e0771812988e02aaebf56` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/forms.ts` | `66272cbd68edf7a23ae886f730853eb48e06010c` | `251e8d2448b1eba3d47672d08e8505f90a9d2292` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/period-formulas.ts` | `c69c2494ee59508e11a5b87faf6856aae624f57f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/restriction-evidence.ts` | `68667a78dea5d586ad9e46e5fce6be7f26528e64` | `3f7bc139deccef22606a58bf2595c20576d4ede7` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-classified-fixture.ts` | `3a61abaaea00651e516805e90b1935f0102f26f6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-classified.test.ts` | `bef3f77c0dfc24b8686c25970472a496a35741f9` | `不存在` | 待行为映射 | — |
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

未来若需恢复引用，在另行授权后以原名称和 head `bbc44a65dfbaef81fc948b1a7f9fcba9d8b07790` 创建引用，并核对 tree `34e4e7655b02840e4971ec8b1ad36c7a49454597`；本草案不执行恢复。
