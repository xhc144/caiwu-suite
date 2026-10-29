# w2-06/templates-official-validation

状态：仅本地归档草案；批次 06；未发布、未创建归档提交、未删引用。

- 原名称：`w2-06/templates-official-validation`
- head：`567a47cf386d08bbfd933435b46260a339c3d6ae`
- tree：`bf6a6beb393b7b8a92532a6f26e764c562f61a1a`
- 原提交父节点：`a55666c960836a2c6482083ba7182c263c761f0b`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/567a47cf386d08bbfd933435b46260a339c3d6ae)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=2，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 6 条；当前 main 相同 0 条；当前或 main 历史同路径命中 5 条。不同 blob 的业务意义尚未审结。

## 未审范围

- 本次比较没有额外的 app/docs 范围外改动路径；仍未对整条旧历史作源码或业务验收。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/modules/templates/README.md` | `7f094e9854db9b8815b6ae8a12a2cdbb31efe30c` | `ef6da040e1bd3726d2ac8aff7fc83a35ac212950` | 待行为映射 | — |
| `app/modules/templates/e2e/templates.spec.ts` | `1ea1e1569216ee011f2e333fce086c1b35e916e5` | `af523edfe0c7a090dc9831164782fa2f7f467f67` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/modules/templates/templates/nonprofit-2026.json` | `c6ef34357b388f71867957bccfc3318f63c5cfe9` | `78a6583bf3f46cdc03fc982efc14c990e8871c3b` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/modules/templates/test/expected-accounts.ts` | `f08f18aa3a8d07c1ed21b53c17a3bf65852c607e` | `3b647b65d9541ed18392556df16b25d3a8349247` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/modules/templates/test/nonprofit-partners.test.ts` | `96677339abb926fcb38b48a4351258e7f6997939` | `6e780c1da87367e29e2a563c68f299d40ec2f09f` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |
| `app/modules/templates/test/templates.test.ts` | `d8c23d19824015c8b8aedbc985f40d2adae87041` | `13ebeae65a256828e11f9df6360d450b061a077f` | 待行为映射 | `437bc89d799c6bfa15d30133d6d136888751d401` |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `567a47cf386d08bbfd933435b46260a339c3d6ae` 创建引用，并核对 tree `bf6a6beb393b7b8a92532a6f26e764c562f61a1a`；本草案不执行恢复。
