# codex/inventory-provider-format-20261026

状态：仅本地归档草案；批次 03；未发布、未创建归档提交、未删引用。

- 原名称：`codex/inventory-provider-format-20261026`
- head：`48c1d3d4354e3bff8ddb1af7481702910d820cf6`
- tree：`268700579e134d57fd0ba258764328c6250f1fe8`
- 原提交父节点：`cd47d15a7b83278378a309a761e1fd26b1edabdb`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/48c1d3d4354e3bff8ddb1af7481702910d820cf6)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=24，behind_by=136；merge-base=`95a54b79170c6b9aeddd2ab5f64f836ab05fecb4`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 65 条；当前 main 相同 19 条；当前或 main 历史同路径命中 21 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/inventory/README.md` | `79783ea9b2c19cf802cefe2ba0d6d0444f3c118b` | `84746b86efa22b7753cd3d69c23dac7159b8d61f` | 待行为映射 | — |
| `app/modules/inventory/costing-contract.ts` | `c6278a9022cd6654f1287e21e602835ba4b795a7` | `f79be645a3469f35f1b82ea7ff6d25b27cfcd31d` | 待行为映射 | — |
| `app/modules/inventory/e2e/cost-balances.spec.ts` | `0362e930618724fc8051ebed9579263b20ebaab1` | `0362e930618724fc8051ebed9579263b20ebaab1` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/manifest.ts` | `e1c942bdce6c7549126b806c899dfd2d7aaff6c6` | `e1c942bdce6c7549126b806c899dfd2d7aaff6c6` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/server/costing-snapshot.ts` | `2764d06f86cd91f099621c25c3db61f07efcbfea` | `2764d06f86cd91f099621c25c3db61f07efcbfea` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/server/costing.ts` | `ebe75e9d027c285538e2d670980733c8d1267919` | `97ea6e66fa5b2c7533cc710056d0b532b2fd1851` | 待行为映射 | — |
| `app/modules/inventory/server/index.ts` | `d0177ababc4f70497955ffef093445e18ec97189` | `51b78d006b8fada6b4d69ee772ad33e12d04d232` | 待行为映射 | — |
| `app/modules/inventory/server/migrations.ts` | `ee02e21d933d6a8faf7d0d58b404000059c3daf7` | `4e36f53a8f78a0ad94a84720e4f09cb585f913f1` | 待行为映射 | — |
| `app/modules/inventory/server/router.ts` | `1e9554c09db174261e5ffbf9fe19ef8dc97cdc47` | `1e9554c09db174261e5ffbf9fe19ef8dc97cdc47` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/server/service.ts` | `94919ca71d3eeaf8625ce8e0a0c5f8bc76ebeb30` | `9982a156d32c0a27fa8fed2f3b6fd4448a7a1478` | 待行为映射 | — |
| `app/modules/inventory/test/core-bridge.test.ts` | `cc66490aebc84dddecf1aec08653909a4962fdd4` | `不存在` | 待行为映射 | — |
| `app/modules/inventory/test/cost-balances.test.ts` | `73e0f729bf2a7741df20ae37da93e6148eeccbd3` | `73e0f729bf2a7741df20ae37da93e6148eeccbd3` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/test/costing-contract.test.ts` | `88ec1facca63bef1a3b1e36665290489f3ae6d3a` | `88ec1facca63bef1a3b1e36665290489f3ae6d3a` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/web/CostingData.tsx` | `d38e84c6bf8c8e57e6fbdc8ebb061ee58798249c` | `d38e84c6bf8c8e57e6fbdc8ebb061ee58798249c` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/web/CountPage.tsx` | `125784c3e976527d9c889ba4f584b30dff8047aa` | `125784c3e976527d9c889ba4f584b30dff8047aa` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/web/ReportPage.tsx` | `3687b77440f56c8ddd429d9166c141ebeebdc7e4` | `3687b77440f56c8ddd429d9166c141ebeebdc7e4` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/inventory/web/StockPage.tsx` | `151aeec96c391b31e5d148080677d8f5c2da442e` | `151aeec96c391b31e5d148080677d8f5c2da442e` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
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
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `adcb2e6facd48e150d5e29b45810dddfe62bc9ab` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `5566fe65b14d444bfc8446152433ebd338f684bb` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/formula-options.test.ts` | `202dfa20be15ca6041bda869c0aa8e66926fcbb9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/retrieval.test.ts` | `23a122047374c3b72e12e21ae8b534dc68065992` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/ytd-scope.test.ts` | `b54250dcc071f1b4f356cdd987c503e1328f0bab` | `不存在` | 待行为映射 | — |
| `app/packages/core/README.md` | `ba81bb638b627176f28fabf3cb7cec13e751b6d5` | `不存在` | 待行为映射 | — |
| `app/packages/core/src/index.ts` | `1bbc0180015abc575d759e63689841cd6c127ccf` | `f3997ab38155e0757dc4e5e2a6152f5943e91af2` | 待行为映射 | — |
| `app/packages/core/src/inventory.ts` | `e4234b7e2e1fcb2384fc320a733ab230d41a2cd1` | `c3dbbe8be1edacf8908ac2dc7f52019d8bfe728b` | 待行为映射 | — |
| `app/packages/core/src/ledger.ts` | `e01324417c4a94bbded00be10119c7951a0d21bc` | `5e1c1e3b69d3c5ddb49dcd2a955432ca767ac72e` | 待行为映射 | — |
| `app/packages/core/src/server/context.ts` | `7cf8b2691bf155afdba364dc90116d8610a98c5b` | `7cf8b2691bf155afdba364dc90116d8610a98c5b` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/src/server/index.ts` | `9cdc5589064347297b1893c0915addec44ac57f8` | `9cdc5589064347297b1893c0915addec44ac57f8` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/src/server/inventory-provider.ts` | `8ee19f558662f3f67fb3935ade35aa6e6940e7c7` | `00d31583e33b2007d23efe8c88663bde683c180d` | 待行为映射 | — |
| `app/packages/core/src/server/service-scope.ts` | `a27964c7f15b73cc4b4cb1dafa876fc2e5ca175d` | `a27964c7f15b73cc4b4cb1dafa876fc2e5ca175d` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/src/server/services/index.ts` | `2757744c1e6b1eb925550a1f4795fe268806111d` | `5ad9ae9e146919387eced988c7c4c06be3faaf84` | 待行为映射 | — |
| `app/packages/core/src/server/services/inventory.ts` | `26f9263a2a1adca9332c1d4c44c7f66e47d889da` | `bc59b553f34ea81432034cbf0bac5a426fe69717` | 待行为映射 | — |
| `app/packages/core/src/server/services/ledger.ts` | `eb182636e989fa00549cec726c4d36cfa742e913` | `28abb4aa14fd219a50c868b1e67410c1399f4fc2` | 待行为映射 | — |
| `app/packages/core/src/server/services/vouchers.ts` | `404791fe3ede2cb1da909e345d9ec4931889d211` | `4fa81acaec8ea7567bffe2268d2f66900ea34946` | 待行为映射 | — |
| `app/packages/core/test/inventory-provider.test.ts` | `978be7ef9d8ba5516a1f63248b17b7d3c9992a3c` | `b254d672f980eb211e0386a49235a892131ec146` | 待行为映射 | — |
| `app/packages/core/test/ledger-closing.test.ts` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | `26ab35f687cd55ee3b206ea57c991f283d0cc63a` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/ledger-ytd-scope.test.ts` | `c5868ec3389bc1a737bcecbf37b1de508648b23b` | `c5868ec3389bc1a737bcecbf37b1de508648b23b` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/voucher-references.test.ts` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | `8ec03359d544cbff98d93f06a2783d7d43cea981` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/core/test/voucher-source-numbering.test.ts` | `b11aab48dc56d5c928bedadfc346f3924f7e0ff6` | `46bb895654c9c50f3574a84aee06f9508e393bda` | 待行为映射 | `f60d98edbd90e438068fd53ebea7cbf6d85dd948` |
| `app/packages/server-kit/src/lifecycle.ts` | `62eb28846995c0d770258d9db990a13621552c0a` | `704b1c841192cf9ec696312178775d898193ddc3` | 待行为映射 | — |
| `app/packages/server-kit/src/module.ts` | `b3d57c00bdb0934b805d782ee639169d2c325fa0` | `b3d57c00bdb0934b805d782ee639169d2c325fa0` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/server-kit/src/procedures.ts` | `51773cecf79a137c64ab735e1e497cd63a0dcfb0` | `daf42e21f59b49996a00076f86b305783021389c` | 待行为映射 | — |
| `app/packages/server-kit/src/registry.ts` | `2fd3aa224c78fe9b3bcb66a2a0f56e8e588f5fac` | `bcc3a33c3dd8e7bd81b2863c54f50ad86e2491eb` | 待行为映射 | — |
| `app/packages/server-kit/test/inventory-registration.test.ts` | `94b0aa34f9deefdb7a16cd24cd767df96a724438` | `597600c506bdfab03dd8b973f479735094a2561c` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/testkit/src/app.ts` | `969033295684b5ebf477f2d4b8972c52f124f2c7` | `969033295684b5ebf477f2d4b8972c52f124f2c7` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/packages/testkit/src/book.ts` | `d99407b5a9ff90f12281d027de99fefe1546258d` | `d99407b5a9ff90f12281d027de99fefe1546258d` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `48c1d3d4354e3bff8ddb1af7481702910d820cf6` 创建引用，并核对 tree `268700579e134d57fd0ba258764328c6250f1fe8`；本草案不执行恢复。
