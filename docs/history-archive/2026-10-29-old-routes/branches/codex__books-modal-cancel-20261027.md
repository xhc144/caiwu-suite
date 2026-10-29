# codex/books-modal-cancel-20261027

状态：仅本地归档草案；批次 02；未发布、未创建归档提交、未删引用。

- 原名称：`codex/books-modal-cancel-20261027`
- head：`af7d398f4abba60006babeb62edb40729b038e8a`
- tree：`c5a733653140df4ccdf7160593ac4a1420918c1d`
- 原提交父节点：`173066678aeb4b8c41e3a967ab5d8e6a654f0723`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/af7d398f4abba60006babeb62edb40729b038e8a)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=17，behind_by=121；merge-base=`dfd60a2ad6dc389e3174d0839967e0e13d9fa62b`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 42 条；当前 main 相同 9 条；当前或 main 历史同路径命中 10 条。不同 blob 的业务意义尚未审结。

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
| `app/modules/masterdata/e2e/reference-excel.spec.ts` | `1c35458b78b5051d43d72bed5154b277ed63e402` | `1c35458b78b5051d43d72bed5154b277ed63e402` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/masterdata/web/common.tsx` | `b5decfc3846c24d040db0b42f9612a13339464b8` | `b5decfc3846c24d040db0b42f9612a13339464b8` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/opening/e2e/import-layout.spec.ts` | `05192fdd2897dcac898f1783149256f7da9400dd` | `05192fdd2897dcac898f1783149256f7da9400dd` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/period-close/e2e/continuous-close.spec.ts` | `a6baa7701c24fa05ca81e4cedb8255bdd257d6e7` | `ed7fbce9263a1cd0ab0decf3258883de8cdef209` | 待行为映射 | — |
| `app/modules/period-close/e2e/period-close.spec.ts` | `482e80089fbe2223aff1d37f8eac264eec81d341` | `e44cea877705d6f774c1184594e55e4f453a29a4` | 待行为映射 | — |
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

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `af7d398f4abba60006babeb62edb40729b038e8a` 创建引用，并核对 tree `c5a733653140df4ccdf7160593ac4a1420918c1d`；本草案不执行恢复。
