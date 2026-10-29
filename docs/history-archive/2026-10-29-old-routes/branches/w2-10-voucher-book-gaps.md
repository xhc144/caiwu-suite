# w2-10-voucher-book-gaps

状态：仅本地归档草案；批次 02；未发布、未创建归档提交、未删引用。

- 原名称：`w2-10-voucher-book-gaps`
- head：`ef0bcf9e77211b890d9150f11c46e8f9a5620371`
- tree：`56bacd7c9a56f1f75c6a6c3b462b83ca52f8a0eb`
- 原提交父节点：`34c472e469be742f51439c8152575a313783c96b`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/ef0bcf9e77211b890d9150f11c46e8f9a5620371)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=5，behind_by=157；merge-base=`a3b60c6f1ea967213578152146c7401977b9199b`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 18 条；当前 main 相同 0 条；当前或 main 历史同路径命中 0 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
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

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `ef0bcf9e77211b890d9150f11c46e8f9a5620371` 创建引用，并核对 tree `56bacd7c9a56f1f75c6a6c3b462b83ca52f8a0eb`；本草案不执行恢复。
