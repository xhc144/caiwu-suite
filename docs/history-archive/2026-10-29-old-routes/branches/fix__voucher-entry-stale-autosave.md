# fix/voucher-entry-stale-autosave

状态：仅本地归档草案；批次 02；未发布、未创建归档提交、未删引用。

- 原名称：`fix/voucher-entry-stale-autosave`
- head：`2ac6cf96294e7a1788f4ea461171abfdbb0de9f7`
- tree：`adfdd2642fc7534c1e9e26de67f0291e41008d1e`
- 原提交父节点：`c53bf14cde552acc83dd7b15b575c918bb5e3b88`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/2ac6cf96294e7a1788f4ea461171abfdbb0de9f7)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=1，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 3 条；当前 main 相同 1 条；当前或 main 历史同路径命中 1 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/voucher-entry/e2e/autosave.spec.ts` | `755cde7bfb71b24ebc51e496bd6f748ac97bd697` | `755cde7bfb71b24ebc51e496bd6f748ac97bd697` | 相同 | `64cf6aea142b8935305c2683585c7df68d24f2e9` |
| `app/modules/voucher-entry/test/entry.test.ts` | `35fbcc7150f19f31695a9ead4c6c3f3364036bad` | `81b54dfc8731042d4d0a0b7773b94814c0d4d70f` | 待行为映射 | — |
| `app/modules/voucher-entry/web/EntryPage.tsx` | `09d4d9a15b0d95782d645f9587e46a63246bdb38` | `ea475513fa0beaf10f74d2c7ea2f6d278c48915e` | 待行为映射 | — |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `2ac6cf96294e7a1788f4ea461171abfdbb0de9f7` 创建引用，并核对 tree `adfdd2642fc7534c1e9e26de67f0291e41008d1e`；本草案不执行恢复。
