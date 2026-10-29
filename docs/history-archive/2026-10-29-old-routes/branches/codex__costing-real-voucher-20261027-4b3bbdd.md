# codex/costing-real-voucher-20261027-4b3bbdd

状态：仅本地归档草案；批次 03；未发布、未创建归档提交、未删引用。

- 原名称：`codex/costing-real-voucher-20261027-4b3bbdd`
- head：`d4133a63d15368f92b4dc6af4522cfe146d67c91`
- tree：`b328a75f3e48ec91da83b662014b8d6f54a9cea4`
- 原提交父节点：`4b3bbdd98bcde31b166888e92b5f394515a0b46b`, `19af7a52e4fdf61cd79c0c299c1f59d71e8d74ea`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/d4133a63d15368f92b4dc6af4522cfe146d67c91)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=110，behind_by=121；merge-base=`dfd60a2ad6dc389e3174d0839967e0e13d9fa62b`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 216 条；当前 main 相同 33 条；当前或 main 历史同路径命中 37 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/books/e2e/books.spec.ts` | `6efe1470ca6ad1a190e7b52c00d6cb8eae48f7f4` | `63fe7b821fdd9d2c2f282e300b21eda4d46e6516` | 待行为映射 | — |
| `app/modules/books/e2e/cancel.spec.ts` | `0c88ed56991c26d8c2f062f7b97334a56d04906d` | `b8c5cb74cf38d599a6d98ae90d522df3cd22d3a4` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/modules/books/e2e/pointer-probe.ts` | `a62599ec80bf04daa261c1cb2078086d6222e854` | `a62599ec80bf04daa261c1cb2078086d6222e854` | 相同 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/modules/books/test/wizard.test.tsx` | `794f8dbd2dc62d13a12a28a5218e02819cb1ebe1` | `eb8afbd0a47dc22b3d7f8a4088c472318b3d6d8b` | 待行为映射 | — |
| `app/modules/books/web/Wizard.tsx` | `7d61c6bbf3c3aa07a4c7b34022a836deb7734c06` | `4b3e73c03649a33e0ca413ae71ea789957212405` | 待行为映射 | — |
| `app/modules/costing/README.md` | `2450be33a5eb26b3fe85f7f7ed8014d4c31690ff` | `35a52a1628d8c410a215bb3d135b64b70bb35d95` | 待行为映射 | — |
| `app/modules/costing/e2e/costing.spec.ts` | `48fae612de558c9ee49af6c3eba4b6bdb61a0a18` | `cc8faf81095f5788d5018dc2625b3dd41e5868ac` | 待行为映射 | — |
| `app/modules/costing/e2e/empty-month.spec.ts` | `5c392f2033b266f36d2a6f60756d2d475b87cc30` | `不存在` | 待行为映射 | — |
| `app/modules/costing/e2e/fixtures.ts` | `9e8872188aa1daa72ed293810fda457b80f806c6` | `不存在` | 待行为映射 | — |
| `app/modules/costing/e2e/formal.spec.ts` | `47f29d14340c813d336d3ee333540a8c0ee412f8` | `不存在` | 待行为映射 | — |
| `app/modules/costing/e2e/guards.spec.ts` | `3f10dae1816c63243193e0fa37944f5adb8adee8` | `不存在` | 待行为映射 | — |
| `app/modules/costing/e2e/vouchers.spec.ts` | `05e38101d27f292de26ac38b9154e7349c5cc6a2` | `不存在` | 待行为映射 | — |
| `app/modules/costing/manifest.ts` | `878809a5c4ae4d030feb14afca8603b97c3bfbec` | `9fdfdb267e82a51a8b2320b231c2f1663ed37a89` | 待行为映射 | — |
| `app/modules/costing/server/calculation.ts` | `b964d0a4f3a59307ec6b2451b0ccca61ae22628c` | `42c608ecb4c3fb57d4f2ae9094b50e3d07167d86` | 待行为映射 | — |
| `app/modules/costing/server/formal.ts` | `2091a5f5cce5b214ee32284f0c8bb3e56d32ad5a` | `不存在` | 待行为映射 | — |
| `app/modules/costing/server/inventory-read.ts` | `6be2b5d8f9104fb868b3e05876b8658e7e611d34` | `be46118d3c8e95232ec18cb17668d9b5ac96ee66` | 待行为映射 | — |
| `app/modules/costing/server/math.ts` | `45eb2199d73c1c6a2ec6f5d629123892171247b4` | `1d34b9c5e143afd367f7e45714d8db4546c2035c` | 待行为映射 | — |
| `app/modules/costing/server/migrations.ts` | `e353a0f79ed7831979d10aede7af447fcc94b346` | `9341c4c65b3c33de099a73d7ac4d0fda7a35c615` | 待行为映射 | — |
| `app/modules/costing/server/router.ts` | `f73e715a1b2e045aff0d474dade50a9152ce292a` | `afea32718239f5d2bbee66083bd518ef203ad0df` | 待行为映射 | — |
| `app/modules/costing/server/service.ts` | `f6831df73d4b936acb901527c524d488d4ee5600` | `2f612effd6dee729f20c42cdba55ef4806ab624f` | 待行为映射 | — |
| `app/modules/costing/server/vouchers.ts` | `eab068e250bf1e796341e6210ab09fcc0b475722` | `c11f050fb87bd3d1d896e1a01e81af15ca0bdf54` | 待行为映射 | — |
| `app/modules/costing/shared.ts` | `987e7856050a42aa84457a464bdb6b8c8311cbad` | `4d894d04043bf9f0709d49a922b3adf956c738da` | 待行为映射 | — |
| `app/modules/costing/test/costing.test.ts` | `da8161a4814d1ff61e84a6734f4ff34c0e2ce1d3` | `6d2da874daee001652193b35249aa13da729ac7b` | 待行为映射 | — |
| `app/modules/costing/test/fixtures.ts` | `a31a9f51da81e99f9283db329957cd77d7bb223b` | `239190fe53e561186ca066d172b0488f46d8c211` | 待行为映射 | — |
| `app/modules/costing/test/formal.test.ts` | `3ee8a4edf1ae04526dc4358a12622c130baf5144` | `不存在` | 待行为映射 | — |
| `app/modules/costing/test/vouchers.test.ts` | `04912d40bcaa520b4ad6b2ff248d0cf92b561e8a` | `不存在` | 待行为映射 | — |
| `app/modules/costing/web/CalculationPage.tsx` | `53bb18ab2f9e9d1ba5d81915d9ae449bd3e933a2` | `6c21b2efbd49201f3b3971313c25e2d50802b3fd` | 待行为映射 | — |
| `app/modules/costing/web/FormalBatches.tsx` | `66a463f8241f25484142c7664826b36e875f304e` | `不存在` | 待行为映射 | — |
| `app/modules/costing/web/ProfitPage.tsx` | `02c2b89f671e9adbd28fb166681e68593f103a96` | `c66547af09d6c52528b390bec5c7dec5cc7f7e76` | 待行为映射 | — |
| `app/modules/costing/web/VoucherPage.tsx` | `1a9ea0fb0521c829ab8cbd8dac365bdc8db8dd12` | `bd48fa63ac100d5024c40dd501fd42a4ca0bb391` | 待行为映射 | — |
| `app/modules/costing/web/index.tsx` | `62e295f38acbc4382084a604e1b1d25e275a45a9` | `9b0c8555f41d0d677c7e025de67c9a885cc78d52` | 待行为映射 | — |
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
| `app/modules/masterdata/e2e/reference-excel.spec.ts` | `1c35458b78b5051d43d72bed5154b277ed63e402` | `1c35458b78b5051d43d72bed5154b277ed63e402` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/masterdata/web/common.tsx` | `b5decfc3846c24d040db0b42f9612a13339464b8` | `b5decfc3846c24d040db0b42f9612a13339464b8` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/opening/e2e/import-layout.spec.ts` | `05192fdd2897dcac898f1783149256f7da9400dd` | `05192fdd2897dcac898f1783149256f7da9400dd` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/payroll/e2e/calculate-button.spec.ts` | `a65c51b710116f92a748d0bcd948a113b6caaa4d` | `a65c51b710116f92a748d0bcd948a113b6caaa4d` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/payroll/e2e/payroll.spec.ts` | `150e9b3b91e4d541f34ee3740fa1652b6b07461e` | `150e9b3b91e4d541f34ee3740fa1652b6b07461e` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/payroll/web/PayrollPage.tsx` | `a28ed56d04897888b2faf5c226e5eee94c96c523` | `79730975dc42bb0233ae52269e5325518be2af89` | 待行为映射 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/period-close/e2e/continuous-close.spec.ts` | `a6baa7701c24fa05ca81e4cedb8255bdd257d6e7` | `ed7fbce9263a1cd0ab0decf3258883de8cdef209` | 待行为映射 | — |
| `app/modules/period-close/e2e/period-close.spec.ts` | `482e80089fbe2223aff1d37f8eac264eec81d341` | `e44cea877705d6f774c1184594e55e4f453a29a4` | 待行为映射 | — |
| `app/modules/report-engine/README.md` | `f17e445fcb280ea24ab6faada99e13efc8dfdf46` | `8b6c5f5d367662bf3cd5ecb47c084ba55c4cc3c9` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/fixture.ts` | `013f4bc1faaabbb58189c8e46ca38b3ede758a5d` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/period-slice.spec.ts` | `d90cb9539154e20d4a68aced7335246941ed8888` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/profile-http.spec.ts` | `8fea1b33d9715d8aa60707777f564abc9c1cbc5a` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/purchase-reclassification.spec.ts` | `dab7144b36121c45e5e95fa4c0c355aaaefe9e9a` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/enterprise/statements.spec.ts` | `e43efe6dea90d5018f84ec80610e9bf265f422bc` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/list-race.spec.ts` | `1f4d2f6b34964e26b8610824c9fbbb0cc0463cb0` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/activity-classified.spec.ts` | `a7363892ba8b03d110efe279fc8fc04ef2100e6f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/balance-sheet.spec.ts` | `e20b5ca4e5f3fea3a10928515b64b14fbb9362bd` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/cashflow.spec.ts` | `848ca9f09d7b02226e3fe7eb152cbeb588f4b599` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/fixture.ts` | `85467a26f639fb63be66d0abf871dd71a53ac8a9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/profile-http.spec.ts` | `7d587ebc195f730f77aff68ba776c30d9ee65038` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/nonprofit/shared-options.spec.ts` | `b05c2ded87462b3ac7fce51553af9cb766c74a15` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/print-accessibility.spec.ts` | `2897162d84c495b0548a1f9eb99715387b88969f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/e2e-fixture.ts` | `646d78b5d96a1fef0554496b9371c96fed7b1153` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/shared/retrieval.spec.ts` | `9739f05832e4a0c0fa2f0cef2dbe13cb057a3ef7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/small-business/fixture.ts` | `0a545f765e6052ebcf17e66e2f0fbb369a579ac3` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/small-business/inventory.spec.ts` | `0589c5e13b8e7a57d573bf1f3e8a462467f8325b` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/small-business/profile-http.spec.ts` | `06bdb7ee796e38e8c5a0845b1d3515dd4b4b066e` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/e2e/small-business/statements.spec.ts` | `f505d10d9a8e26ba5fa03283246593b4aabf8dfb` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/export.ts` | `0cf76ce672a879a6f7bfda243833fe09c71c95f7` | `58770fd6787bd5588d333439ccdcdf61b89632a3` | 待行为映射 | — |
| `app/modules/report-engine/server/formula.ts` | `ac39b28ca68748b39141acd28243f814e20c72ab` | `d147d266271835ab57aa5c8172661662d85cea8b` | 待行为映射 | — |
| `app/modules/report-engine/server/migrations.ts` | `a6fa489c2d77f791644e9090061c56f057228086` | `0bc509774d7e973cf6360177d0679c98da8a1353` | 待行为映射 | — |
| `app/modules/report-engine/server/profile.ts` | `de015cfff08dd6d06d26ef653bd971b62809bfd0` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/server/router.ts` | `8d4c4f93f5c6daa80bdeda7be979a89fddb310c9` | `57aa8c399999c73c46deb788d4e6c5bda81a6cf0` | 待行为映射 | — |
| `app/modules/report-engine/server/service.ts` | `5caefe9bbd78f0589d2d0e3827e69e686415eda9` | `23fde790f5eeb0fcdbbd3c1f766b158df38837d6` | 待行为映射 | — |
| `app/modules/report-engine/shared.ts` | `9da982e070860b33ebcb4097f99fad868bf3c597` | `e11562faa3f46a1b3b0bdaea3edc0c6f6fb51099` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/201.json` | `0f538bbeb2f8466424fc8a2a9d36fc7772bdabab` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/202.json` | `c7e0cd7328a1d09ff858978ce6434bf0a172e38d` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/203.json` | `7960484c6b1a5c05b980e0e513a010080b44f528` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/README.md` | `08eef785317d453e8bb05d20fff4799e349c71bd` | `33957300808b9d27bad97a3dd28f339a9ec5c779` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/index.ts` | `9e7fac4d4e549747da644dd7563b2cb84ba9fba2` | `9fc900fef0fda11525a4126ff383922f0a04b33f` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/lines.ts` | `8d310ba9b1ceef51700489a569dff13985e18f30` | `8d310ba9b1ceef51700489a569dff13985e18f30` | 相同 | `4f9479106e4ab189eb08cec0ce4befd2ab96534f` |
| `app/modules/report-engine/templates/enterprise/period-slice.ts` | `8282f88cce7491243822d7e1f716448c14ab2777` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/enterprise/purchase-reclassification.ts` | `35ee7da25b39d83d9c0f63f2a1d3961f906d1272` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/README.md` | `b53849d33398a94dc6a43053d0de7e17b0d23b47` | `77038c1eec61d8fe2df13a540367403dabb9fca7` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/activity-classified.ts` | `bd189bdd8de84a18a01438940ebe0068a2ac4d01` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/activity-totals.ts` | `837aeafafe99c5cc8a54e3530fff3f4fffd53e1a` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/balance-sheet.ts` | `50ff439467fd0054a9a194048623e1a9d66bf4b6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/cashflow-comparative.ts` | `e86c56aba519ee76bce813788e9f9c7d2a3ce1f1` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/cashflow.ts` | `6652b86580aba846e07ebb39c575db300750cae3` | `26cb4c6c8d503906846e0771812988e02aaebf56` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/forms.ts` | `66272cbd68edf7a23ae886f730853eb48e06010c` | `251e8d2448b1eba3d47672d08e8505f90a9d2292` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/period-formulas.ts` | `c69c2494ee59508e11a5b87faf6856aae624f57f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/nonprofit/restriction-evidence.ts` | `68667a78dea5d586ad9e46e5fce6be7f26528e64` | `3f7bc139deccef22606a58bf2595c20576d4ede7` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/301.json` | `afa96ca035ab3e5bdb4d789c1954ebcfbc6f1e08` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/302-annual.json` | `06c2593c10253adf8d6f332b3904a5b467279a7a` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/302-monthly.json` | `74335148458d16521a667aa2f90d21a11df28bf1` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/303-annual.json` | `edb65a35c13bc05c8e411c7b7110db27a80ec328` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/303-monthly.json` | `231ea6df8e8e4d44d80c8a475df8b5e544e13491` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/README.md` | `5570def97767f9ba4a0268254af1f1458acdba7a` | `c1e0858f4fa114f619ebc76a21355be2a885c82e` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/catalogue.ts` | `4cf951551bfc4287779105e6a0597d4f26c1c459` | `4cf951551bfc4287779105e6a0597d4f26c1c459` | 相同 | `4f9479106e4ab189eb08cec0ce4befd2ab96534f` |
| `app/modules/report-engine/templates/small-business/extended.ts` | `7b5c5cec5878a86f29f8ebdbe959439c00765abe` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/inventory-balance.ts` | `f3beaedcdd5276ae13704063e58eb0f87fc8844f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/templates.ts` | `d805efe70fb0ffd6a650949bc5a132b594f9de6c` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/templates/small-business/write-templates.ts` | `26cfdd167a292bcd6f6d19f633321a98699389a4` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/fixture.ts` | `bb6b526b99e928638f81237eea1ff4220f9f11a8` | `c6a772c17dbb343c831392d3dd7492cb1d5dca64` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/mapping.test.ts` | `eda4b9b5c627fe662f0183b9923455c24f36eed3` | `79b4620f502ed5fa2e33be7563ab7a3cd854a7f9` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/period-fixture.ts` | `7b7fa4d06281abef7063ec6f5f3625d33c1783bd` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/period-slice.test.ts` | `e3f93983824285929169d312b360ebfc45eb0b6b` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/purchase-fixture.ts` | `7db1cdd90c8b000378870e996fd4b763c6c5d860` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/purchase-reclassification.test.ts` | `cc417382d035ba8fe00f7bb769cadb2590b173a7` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/enterprise/statements.test.ts` | `123ba62cd48db9ac5dace14093924b05c15a46b3` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-classified-fixture.ts` | `c859777f7730afd12f0a9e10d098bdd36522e511` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-classified.test.ts` | `e6cb04dbc6624d27bdd87a052d8c0238333583c5` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-fixture.ts` | `b53dee15990d96a4c8ae13bed6e42d04d3705b19` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/activity-totals.test.ts` | `894ba46939c843e6e804dd8012553e4f480b14be` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/balance-fixture.ts` | `22359caab5455fc0bbf565509359d2ae41ef65ef` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/balance-sheet.test.ts` | `f4c2765bb637f2e44eb05ad888686f9b358fcce6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/cashflow-comparative.test.ts` | `0ae92d821d5c12e695a7797952892b9cbf8c382f` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/evidence-fixture.ts` | `1df89ca6bad5de663a8d084af15632178dae5c30` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/fixture.ts` | `1d02d1d0771a164f12bb885167e263677fb1fc3f` | `55a551c427811f59418cebde9808276dbc53418f` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/golden.test.ts` | `57fb8835cbd08e7a580a8442e342a1ce8a4e336a` | `794e20e71f7b709dd27f8c9f93afe216f35f9c6a` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/recognition-confirmation.test.ts` | `5616e0f737b3235ca43dd896348280b557bcec03` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/reports.test.ts` | `9eb25a14e29f353a8bd49338a47f544977bd9808` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/nonprofit/restriction-evidence.test.ts` | `ba080c0651ece415786cb4fd3431c2fd432c54b6` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/formula-options.test.ts` | `202dfa20be15ca6041bda869c0aa8e66926fcbb9` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/profile.test.ts` | `338eaec83bbd53f4947fba1f2d7589720b0c23dd` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/retrieval.test.ts` | `23a122047374c3b72e12e21ae8b534dc68065992` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/shared/ytd-scope.test.ts` | `b54250dcc071f1b4f356cdd987c503e1328f0bab` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/small-business/extended-fixture.test.ts` | `79c764cd3b0501193a87f125ee8a1f31e6defe4b` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/small-business/extended-fixture.ts` | `faeea714fbf864c7b04e6ee52ceff9d36602270d` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/small-business/extended.test.ts` | `e809cf459384ed191997a8cf0d8163bb970a62ac` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/small-business/fixture.ts` | `31c01ec49a3f7288e209225a05ed98aa93083e63` | `31c01ec49a3f7288e209225a05ed98aa93083e63` | 相同 | `4f9479106e4ab189eb08cec0ce4befd2ab96534f` |
| `app/modules/report-engine/test/small-business/inventory-fixture.ts` | `737de0ab19e9371f9295f384a36c0b00e8624241` | `不存在` | 待行为映射 | — |
| `app/modules/report-engine/test/small-business/inventory.test.ts` | `8b744c0565118cf0c2998f0b0238a1c901a8ddbb` | `d4b6d544f997fc16c43cd8c487e4cfa8c781698a` | 待行为映射 | — |
| `app/modules/report-engine/test/small-business/statements.test.ts` | `2ce6be2b2895e97c627c5ba12496d8bc4161dde0` | `c5161ea2df4ab75068f4d9fe0b2984f78608ddd1` | 待行为映射 | — |
| `app/modules/report-engine/web/ListPage.tsx` | `1c41b3f856f163bcec48683074ad93b1e2b201ca` | `243ab228332b712081b68c8276304b677d2bdbcf` | 待行为映射 | — |
| `app/modules/report-engine/web/ViewPage.tsx` | `1c1e2210daf2e28b8657f08b3b47c21fb705b4be` | `2509f460a6e3198d0619fe98b24009f0a3b0deba` | 待行为映射 | — |
| `app/modules/voucher-book/README.md` | `e620d8a380326e303b5f784199c59ca6e418a2ba` | `cbb724a27bd1967797bf4bfcd2985ffb4d4bfb05` | 待行为映射 | — |
| `app/modules/voucher-book/e2e/cashflow-joint.spec.ts` | `acca69016ad2ede6e1b6a96f196c831aa31d3d2d` | `不存在` | 待行为映射 | — |
| `app/modules/voucher-book/e2e/voucher-book.spec.ts` | `bee68a17441c541fce485bf384e739c2474696e9` | `d229194c379acc715ec987c006057b02d8e638b5` | 待行为映射 | — |
| `app/modules/voucher-book/e2e/w2-gaps.spec.ts` | `997882da35a30e151d7006a7e3647ae1903f1115` | `不存在` | 待行为映射 | — |
| `app/modules/voucher-book/manifest.ts` | `6add5dfa737273484999152b59601538fa9599fc` | `71fbf46336647bbcb5a3855b19f42d0ee3eee54f` | 待行为映射 | — |
| `app/modules/voucher-book/server/router.ts` | `14e90a44da42fc3264523469d3a301c5b60ea72d` | `216d9dfc228c0d3f94eae21f5512134f37594afc` | 待行为映射 | — |
| `app/modules/voucher-book/server/service.ts` | `af01140f3e938c55bde5da59bd342f2e3a1fd791` | `54bdd5a158ed965684ff23cffd418dd2186d0988` | 待行为映射 | — |
| `app/modules/voucher-book/server/transfer.ts` | `2ea6389762c693ff00e1e15de68306a0c4a1653d` | `1aea1aa88dc7059538130fd5f97379f7858711d2` | 待行为映射 | — |
| `app/modules/voucher-book/shared.ts` | `09e0d53d4a68aeae3c75ea8f57bfa2a8332fa4be` | `61d3d8407f21756edcaea44286c87f5610bf3691` | 待行为映射 | — |
| `app/modules/voucher-book/test/invariants.test.ts` | `a575a4599f1bb955c0d9ae964da2e84889787869` | `cbb56f1d8ce95fd06be7549cde8644913a10910b` | 待行为映射 | — |
| `app/modules/voucher-book/test/reversal-cashflow.test.ts` | `6596302e311bb1fcd12ea1c29684b9a00639b1b9` | `不存在` | 待行为映射 | — |
| `app/modules/voucher-book/test/voucher-book.test.ts` | `b397c01409e7fc36146d52e35ad838b7daa51c87` | `0939d24655238d14c354ac6f8984111f639b860f` | 待行为映射 | — |
| `app/modules/voucher-book/test/w2-gaps.test.ts` | `7a051134b6811f5e7954f880b4f737ff7f7406c5` | `不存在` | 待行为映射 | — |
| `app/modules/voucher-book/web/BookPage.tsx` | `fc04b291126f8e1edee72c3fc3ebd54fe25c5379` | `282e1e8a4915e83b62670a6c0c1388ff11379ea0` | 待行为映射 | — |
| `app/modules/voucher-book/web/ImportDrawer.tsx` | `1290f9f1f8004759ae895225059c78a90cd18f13` | `44e98b87fad0a20053a7704f21e35d5685e39be5` | 待行为映射 | — |
| `app/modules/voucher-book/web/ReportPage.tsx` | `3b9a828c117e42284bfb10e165918d6eb7fab281` | `4359e1a65318cf82e8f90e44fefa01d9f74a4f52` | 待行为映射 | — |
| `app/modules/voucher-book/web/ResultDrawer.tsx` | `c02db636c033155562e0ad4a15ed25d095cdf447` | `不存在` | 待行为映射 | — |
| `app/modules/voucher-book/web/report-print.ts` | `319de6dc94f794804b8c266a785c0836fee9146a` | `不存在` | 待行为映射 | — |
| `app/modules/voucher-entry/README.md` | `e1aa04d3258b1b796a77ac22c309037bc6e6ff3d` | `85a5fb1101affc571e9a4bb9de6f514100458d60` | 待行为映射 | — |
| `app/modules/voucher-entry/calculator.ts` | `6d37620bd68af1dd9581d852fe14b2d2d61cdaf1` | `6d37620bd68af1dd9581d852fe14b2d2d61cdaf1` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/voucher-entry/e2e/autosave.spec.ts` | `755cde7bfb71b24ebc51e496bd6f748ac97bd697` | `755cde7bfb71b24ebc51e496bd6f748ac97bd697` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/voucher-entry/e2e/w2.spec.ts` | `5623e0b14c8bb3861e5f2029843e23253b79d29f` | `dac911f862ec6ce3e4d38b4f49b357d96cb503c3` | 待行为映射 | — |
| `app/modules/voucher-entry/server/router.ts` | `1b2637a619dc02649be3e5427c0a749982b3fba7` | `1b2637a619dc02649be3e5427c0a749982b3fba7` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/voucher-entry/server/service.ts` | `1381a49ffb5feee65dcfbb618f1614d1e003d97d` | `b21de089169f087f4a1fea3dc7c844791b935c5e` | 待行为映射 | — |
| `app/modules/voucher-entry/shared.ts` | `99ec7dfec7042b7c5eb5f441fd59590cdb1a9e3f` | `a4c297115bbf3587872e6a11d21dd8c4e7b008c7` | 待行为映射 | — |
| `app/modules/voucher-entry/test/calculator.test.ts` | `a37b8090ffd3a6866ca7c807974990ff5f3fc4e9` | `a37b8090ffd3a6866ca7c807974990ff5f3fc4e9` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/voucher-entry/test/entry.test.ts` | `35fbcc7150f19f31695a9ead4c6c3f3364036bad` | `81b54dfc8731042d4d0a0b7773b94814c0d4d70f` | 待行为映射 | — |
| `app/modules/voucher-entry/test/w2.test.ts` | `5f23e6b013c61cce879b6a487b17269a3335952b` | `cba07dfc8208cc06315870b9af20792ceb894372` | 待行为映射 | — |
| `app/modules/voucher-entry/web/CalculatorDialog.tsx` | `9532cb219d63a9c01f7ee8abf5a998d1e1c3dcfb` | `9532cb219d63a9c01f7ee8abf5a998d1e1c3dcfb` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/voucher-entry/web/EntryPage.tsx` | `7136e574c06c542f3a4f2e2b0b5bf0f260571d08` | `ea475513fa0beaf10f74d2c7ea2f6d278c48915e` | 待行为映射 | — |
| `app/modules/voucher-entry/web/LineGrid.tsx` | `757bc48477ced2d80ce01f495f6e9ddcff2441e4` | `aab963940f56eadb374ffae256f94a445fc7ab7e` | 待行为映射 | — |
| `app/modules/voucher-entry/web/TemplatePage.tsx` | `afd6be5cd1eef4a5a660e72c2a525a5675816a16` | `72b3c8fd577d1c6ac0f0c1a1bb7e1a3f22ad1393` | 待行为映射 | — |
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
| `app/packages/core/test/inventory-provider.test.ts` | `358000812cd3cc6dccf9854e36da39d68a045549` | `b254d672f980eb211e0386a49235a892131ec146` | 待行为映射 | — |
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

未来若需恢复引用，在另行授权后以原名称和 head `d4133a63d15368f92b4dc6af4522cfe146d67c91` 创建引用，并核对 tree `b328a75f3e48ec91da83b662014b8d6f54a9cea4`；本草案不执行恢复。
