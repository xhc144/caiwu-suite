# codex/wave1-m08-multicolumn-20261026

状态：仅本地归档草案；批次 06；未发布、未创建归档提交、未删引用。

- 原名称：`codex/wave1-m08-multicolumn-20261026`
- head：`5714c533405f612ea05b754b9ed2d846e49d8f49`
- tree：`ca9ba374ac8c25afb4d94257f6c21709476f2005`
- 原提交父节点：`eb36c35d552ccec8f5c9425cbcf9072aeaab4c21`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/5714c533405f612ea05b754b9ed2d846e49d8f49)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=2，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 10 条；当前 main 相同 0 条；当前或 main 历史同路径命中 0 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/ledgers/README.md` | `6387d70b1fdd8a79aae0111710edc8f8f9b58c9b` | `9230cb6e4a68c5b7dc60414a3d4e87ac0af06e68` | 待行为映射 | — |
| `app/modules/ledgers/e2e/multicolumn.spec.ts` | `0398a2b0873c3e69ae09c7a1492b7f3de80dea75` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/manifest.ts` | `e094ff769d2faf938f3ffc42b4e96599902d93b2` | `7c80641ec8be40514207c2b4e715797815c423e9` | 待行为映射 | — |
| `app/modules/ledgers/multicolumn.ts` | `fc2afdcbd3a95e9573873e1662d3503700d8e26d` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/server/multicolumn.ts` | `e6f9a209f898f6ea0a80e8e6ded20e76b9f4884c` | `d9631f96e3bd7718d3ff3ba3cdd656650e997148` | 待行为映射 | — |
| `app/modules/ledgers/server/router.ts` | `70c0472ec2c3423afb43776b4f0f3123f4b56d04` | `2cce59201785e3910fd2721f105d0254e402917d` | 待行为映射 | — |
| `app/modules/ledgers/test/multicolumn-seed.ts` | `27e8097aa3dd887592e3a14e972927f56d11980b` | `964713fd5d725b29603eae7ef7bd9ff7fa69c4d0` | 待行为映射 | — |
| `app/modules/ledgers/test/multicolumn.test.ts` | `be0d4a2ff8ec5b5e79ed24e6432dbd0e838cd621` | `7bd81c7de14101acdf70f7c3a91a64dbe350cb11` | 待行为映射 | — |
| `app/modules/ledgers/web/MultiColumnPage.tsx` | `211f1852cbd8d2a9dcb6bee7fb0a9cc02f4913e5` | `不存在` | 待行为映射 | — |
| `app/modules/ledgers/web/index.tsx` | `3c4fe27b30ca5a8a3d4cf33d53bce4d5c13b22d1` | `f0bf2885130a52005d3618415644c59851c6b0e5` | 待行为映射 | — |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `5714c533405f612ea05b754b9ed2d846e49d8f49` 创建引用，并核对 tree `ca9ba374ac8c25afb4d94257f6c21709476f2005`；本草案不执行恢复。
