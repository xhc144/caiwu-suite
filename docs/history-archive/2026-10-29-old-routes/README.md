# 旧开发路线历史归档方案（本地草案）

本方案只准备元数据与归档说明，尚未批准或发布。没有创建归档 commit/tree/blob 对象，没有更新 main、创建或删除任何 ref，没有运行测试。旧路线的业务完成状态不变。

## 冻结范围

仓库：`xhc144/caiwu-suite`。2026-10-29 00:33:26 UTC 复读远端共 42 个分支；本次 25 个 head 均未移动，均没有 open PR。

比较基准 main：`dd4df52d9a70033f24630c5074755c8419a857c8`，tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`，app 子树：`a3b5c1e2749fd044922c5b4c451be3aeff127d6e`。这只是本次审计基准；未来发布必须重新取实际 main，不能把本草案的旧 tree 覆盖到更新后的生产主干。

本方案覆盖快照中的 25 条旧路线；其余 17 个分支仍由活动集成或独立清理计划处理。

这 25 条旧路线共列出 1612 条普通 app/docs owned 路径，其中 239 条与当前 main 完全相同，277 条在当前或 main 历史同路径有相同 blob；另外 5 条范围外路径只登记元数据。它们有 157 个去重后、基准 main 历史尚未包含的提交 SHA。以上数字均不是业务缺口或验收数量。

`manifest.json` 保存每条原名称、head、tree、原父节点、main compare、逐路径 blob/mode、历史见证、未审范围及恢复入口；`branches.tsv` 与 `branches/` 是可读索引。只保存已有 public 提交的对象标识，不复制旧源码、禁止目录、安装资源、秘密或原始数据。

## 最新状态与原审计证据

2026-10-29 00:40:00 UTC 实读 main 为 `b4f296e3a64d1603aaa993506dc7a79fa63140f6`，tree 为 `e9981ccf60fde85f91b4c9ce28f60df41011d9fe`。PR159 已于 00:32:48 UTC 正常合入（merge `1c8e9615e6fbe9d442b801ca0dd720ce3b927528`）；PR161 已于 00:35:00 UTC 合入当前 main，其实际合入 head 为 `59210b09dfb283f951dbe9c9a3d87dd7795700fc`。PR146 仍为 open，旧 head 为 `bfd047c1fcd7141f37e56def234314aea0d1a801`。新 templates-next 由新 owner 维护并受保护。

上文 dd4、42 分支以及逐路径比较是当时的冻结审计证据，保持原值，不改写成对 b4 的比较结果；42 不是本段新观测的实时分支数。最新元数据另存 `current-status-2026-10-29.json`。

归档方案当前仍只在本地。最终必须建立 draft PR、经根独立审查后正常 merge commit 合入；禁止直接移动 main。

## 归档提交的对象结构

对发布时实际 main `P0`，拟构造顺序相连的归档提交 `A1…A6`。每个提交的第一 parent 是前一个已批准主干/归档提交；额外 parents 是该批下表所列的冻结旧 head。所有旧 head 及其全部祖先因此可沿 main 的提交图访问。

每个 `Ai.tree` 必须从其第一 parent 的 tree 派生，只增加本目录新的归档 docs。所有原有路径的 blob 和 mode、app 子树及其他生产子树保持完全一致；不复制旧 head 的 tree，不采用旧 workflow，不新增生产代码或资源。

未来可用 GitHub connector 的 `create_tree(base_tree_sha=实际父树, tree_elements=新增归档docs)` 和 `create_commit(parent_sha=第一父节点, additional_parent_shas=该批旧heads, tree_sha=已核对的docs树)` 实现。这里仅说明对象关系，本草案没有调用这些写操作。不得使用 ours 合并或其他空策略合并来冒充业务集成。

提交信息应明确写为：`archive(history): 保全旧开发路线 <批次>（仅历史留存，未作功能合并或验收）`。`archive_commit_sha` 等发布结果目前一律为空。

## 建议分批

按旧路线领域分为 6 批，分别为 3、5、5、5、3、4 个额外 parent。这个规模便于审查父节点清单，不是 Git 的数量限制。批次仅用于历史保全，不是功能完成批次。

| 批次 | 范围 | head 数 |
|---|---|---:|
| 01 | 环境与桌面旧路线 | 3 |
| 02 | 账套交互与凭证旧路线 | 5 |
| 03 | 库存与成本旧路线 | 5 |
| 04 | 企业及小企业报表旧路线 | 5 |
| 05 | 民非与共享取数旧路线 | 3 |
| 06 | 账簿、模板与导入旧路线 | 4 |

## 25 条冻结路线

| 批次 | 原分支名 | head | tree |
|---|---|---|---|
| 01 | `claude/elegant-sagan-91n3gs` | `16d9f94b3d3397db3a3f9d9cd4eec01bd4bca5aa` | `6c3aa6637ecfb59a17c5fb779fe275842c431e1d` |
| 02 | `codex/books-modal-cancel-20261027` | `af7d398f4abba60006babeb62edb40729b038e8a` | `c5a733653140df4ccdf7160593ac4a1420918c1d` |
| 03 | `codex/costing-real-voucher-20261027-4b3bbdd` | `d4133a63d15368f92b4dc6af4522cfe146d67c91` | `b328a75f3e48ec91da83b662014b8d6f54a9cea4` |
| 03 | `codex/inventory-provider-format-20261026` | `48c1d3d4354e3bff8ddb1af7481702910d820cf6` | `268700579e134d57fd0ba258764328c6250f1fe8` |
| 03 | `codex/inventory-provider-format-final-20261026` | `a77023af2eda4d4099704dd8beb8a0027f32609c` | `9afb7468aecf104ca2a27ca6b411bda7f6c21ac5` |
| 04 | `codex/report-profile-gates-20261026` | `cef90b1e2d4c5ab480dc5b3b2eb0d9779a15405b` | `57958be9f6fd4a9b400c980c8a54ed330a26f6a4` |
| 01 | `codex/testkit-windows-stdio-20261027` | `6e861283ab2e536fb8b988ebf3626a4a2694a61e` | `edda9a06d9ac898b7f9b9c1750e7e9b79d32a786` |
| 04 | `codex/w2-02-enterprise-purchase-20261026` | `b45f491c5491f3dff6d1f27f4a7dada4e5eb5145` | `d1bbd5b93a9ba912e2558ffc8d2b7604a4d306b2` |
| 04 | `codex/w2-02-enterprise-statements` | `91e8e30435923db730881c9fa765f883364d2028` | `c8ea82a8145d42872178369c0a9a42ee6991c6e7` |
| 04 | `codex/w2-03-small-business-20261026` | `6b9d2c6c17b3a10c5bbfc0694a17d172c1f59d94` | `4d90c2a42cfb80c948a89983c227f03029855472` |
| 05 | `codex/w2-04-nonprofit-20261026` | `7388834962dcfa3e96dac5adb37ea6104c8aaa3f` | `f5b67769dfa586afcf344db7aeb6ce0445ef112e` |
| 06 | `codex/w2-12-ledgers-20261026` | `ad7176449a3cf28c4e04fe2572cdf090dc7bfacf` | `352fcf9ec7e49ff2535ad570a67900212c4e87aa` |
| 04 | `codex/w2-14-report-ui-20261026` | `100fdcf71b365cd1ac364f3007911810aea3336b` | `0f0264633d9fea284a779c1242021a9c9dc5a64c` |
| 06 | `codex/w2-22-legacy-import-20261026` | `e682c8bb60e85b87836828df7931722eb9992ce0` | `9973169839c8e4f0eeebdaec7e797b35a48fbc9f` |
| 03 | `codex/w2-costing-formal-release-20261026` | `ed770fb2517b9ea5d90cb9bafa7121955cf22671` | `9b7ac43f6bb6c9bd1fca72999806afa9965e1886` |
| 03 | `codex/w2-inventory-costing-bridge` | `cd47d15a7b83278378a309a761e1fd26b1edabdb` | `242194a4c78f2a5edca32ca26fc3addc3b491c5f` |
| 02 | `codex/w2-native-voucher-preflight-20261026` | `2ba1e8a799f5d1295795a58528cb462445e38c36` | `874c47eddf786f402a2d61a391e8cdced4073e61` |
| 05 | `codex/w2-shared-report-query` | `c9f886ae8523215418aa13963f5db98ab489e844` | `e5712e0e20312806b4132ef8d475134023501638` |
| 05 | `codex/w3-nonprofit-classified-20261026` | `bbc44a65dfbaef81fc948b1a7f9fcba9d8b07790` | `34e4e7655b02840e4971ec8b1ad36c7a49454597` |
| 06 | `codex/wave1-m08-multicolumn-20261026` | `5714c533405f612ea05b754b9ed2d846e49d8f49` | `ca9ba374ac8c25afb4d94257f6c21709476f2005` |
| 02 | `fix/balances-modal-confirm-20261027` | `2d2eaccdeb0cb80bca42fa7fafadcb824b2bbd27` | `508d79fa9b8255b7779d2e45050810505bd143b8` |
| 02 | `fix/voucher-entry-stale-autosave` | `2ac6cf96294e7a1788f4ea461171abfdbb0de9f7` | `adfdd2642fc7534c1e9e26de67f0291e41008d1e` |
| 06 | `w2-06/templates-official-validation` | `567a47cf386d08bbfd933435b46260a339c3d6ae` | `bf6a6beb393b7b8a92532a6f26e764c562f61a1a` |
| 02 | `w2-10-voucher-book-gaps` | `ef0bcf9e77211b890d9150f11c46e8f9a5620371` | `56bacd7c9a56f1f75c6a6c3b462b83ca52f8a0eb` |
| 01 | `worker/w2-desktop-updates-20261026` | `f5f1616837c21783cc7cd0af19f2ac48aba8c70e` | `cf0535979122278fc5ebd2cb8f8d76e584dea33a` |

## 发布顺序与生产树不变条件

1. 根先审查 25 条范围、原 head/tree、分批 parents、未审范围和剩余功能清单。当前仅有本地 docs 草案，未创建候选 Git 对象、分支或 PR。
2. 和真实生产 owner 协调活动成果。PR159/161 已合入 b4；其他 wave3 活动、新 templates-next 及后续真实集成仍受保护。增加 parent 会改变祖先关系及后续 merge-base，不能干扰活动功能合并。
3. 未来另行授权后，复读实际 main 与 25 个 refs/open PR/writer，在独立归档提案分支构造六批候选链。每一步从其实际第一 parent 派生，只追加本归档目录的新 docs；逐路径核对所有原有 blob/mode、app 与其他生产子树一致。
4. 把候选链作为 `head`、`main` 作为 `base` 创建 **draft PR**。PR 明确标题为历史保全，列出全部额外 parents、生产树不变证据、未审范围和未完成清单。根对实际 PR head/tree、完整归档图与所有原有路径独立审查；本地草案不替代该独审。
5. main 或提案 head 移动时暂停，按实际新 main 重建并重新审查候选，保持 PR 的当前生产树与基线一致。不得直接更新 main、强推 main 或复用旧 dd4 树覆盖后来真实集成。
6. 仅根独审闭合并确认最终 head 后，解除 draft 状态并通过正常 **merge commit** 合入，使用 `merge_method=merge`、`expected_head_sha=已审PR head`。归档 PR 不能 squash 或 rebase；这两种方式不能保留该候选链的额外-parent 历史保全结构。禁止绕过 PR 直接移动 main。
7. 正常合并后，根复读 main、实际 merge commit 和提交图，逐个 compare 确认 25 个冻结旧 head 都成为 main 祖先，核对 tree 可回读，归档说明与未完成清单仍在。
8. 只有在保全已确认、原 ref 未移动、没有 open PR/当前 writer 后，根才决定是否逐条删除旧 ref。若旧 ref 移动，冻结 head 归档并未保全新提交，必须保留该 ref。此步骤不授权删除提交、标签或仓库，也不由本草案执行。

归档是可达性保全，会使旧 head 在 Git 图中成为 main 祖先，但不会把其业务改动写入当前生产树。归档后普通 merge 可能把这些历史视为已包含；未来恢复业务应从当时 main 新建工作路线、显式移植所需补丁并真实审查，不依据祖先关系宣称已实现。

## 实际 SHA 与发布回执

归档提交的 SHA 由其 tree 和 parents 决定，不能把自己的最终 SHA 预先写进同一个提交的 docs。本方案的空字段是未执行状态，不伪造预期 SHA。

六批候选构造并核对后，可再追加一条只有一个 parent（A6）的 docs-only 回执提交，只新增回执文件，记录实际基线、A1…A6 的 SHA/tree 和已经完成的图/树核对。它不预写 main 更新成功或分支删除成功。回执同样进入 draft PR；根独审完整候选链后，才由正常 merge commit 合入 main，核对最终 PR head。操作完成后的合并及 ref 结果放在后续新增记录或交付回执中。原有生产文件与既有 docs 均不需要改写。

## 剩余功能和未审范围

`remaining-work.md` 保留环境/桌面、账套交互、凭证暂存及序时簿、库存成本、三制度报表、账簿多栏、导入预检、模板适用性等待核主题，并指向逐路径证据。不同 blob 只说明旧版本不同，不能判为当前缺少功能。冻结 head 中原 README/PR 的未实现清单完整保留，不因归档或删分支而被勾选完成。

本轮未读取或改动旧 `src/`、`tests/`、`packaging*/`、`.ai-handoff/`、`docs/acceptance/`，未读取原安装资源、秘密和原始数据。范围外的旧 workflow/AGENTS 仅登记路径，未采用内容；未修改 workflow，未运行测试，未作功能或验收通过结论。

不把任何 `wave3/*` 活动成果、PR146/159/161、analysis-next、backup-next、cashier-next、新 owner 的 templates-next 加入额外 parents。活动成果及其功能待办必须真实集成。两条另有历史保全证据的旧 m21 路线也不在本次 25 条范围中。

## 恢复与后续记录

归档后的旧文件树通过各条 `source_tree_url` 和固定 head/tree 浏览，不必复制到 main。将来需要恢复分支时，只有另行授权后才以原名称和记录的 head 创建 ref，并回读 tree；不能用当时 main 的树代替旧树。

若根决定发布，须补记实际 main 前后 SHA、每批归档 commit/tree、25 个 head 的祖先证据及逐条 ref 删除结果。当前这些发布字段保持为空，`published=false`、`ref_deleted=false`。
