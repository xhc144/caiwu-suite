# claude/elegant-sagan-91n3gs

状态：仅本地归档草案；批次 01；未发布、未创建归档提交、未删引用。

- 原名称：`claude/elegant-sagan-91n3gs`
- head：`16d9f94b3d3397db3a3f9d9cd4eec01bd4bca5aa`
- tree：`6c3aa6637ecfb59a17c5fb779fe275842c431e1d`
- 原提交父节点：`3d1d40e6799be790f784a62c92feabe8c5e47dd0`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/16d9f94b3d3397db3a3f9d9cd4eec01bd4bca5aa)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=1，behind_by=186；merge-base=`3d1d40e6799be790f784a62c92feabe8c5e47dd0`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 4 条；当前 main 相同 0 条；当前或 main 历史同路径命中 0 条。不同 blob 的业务意义尚未审结。

## 未审范围

- `.github/workflows/app-ci.yml`：仅知道比较元数据中的路径，未读取该旧版本内容；不作采用或批准结论。
- `AGENTS.md`：仅知道比较元数据中的路径，未读取该旧版本内容；不作采用或批准结论。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/CODEX_SETUP.md` | `4426621cb7fe86d162ce8752bb8be5e76fd5b7d2` | `cf5005056d81832e01f0644acb0a9c5ffd03f43c` | 待行为映射 | — |
| `app/playwright.config.ts` | `ace18196f6ff66d8e69b8aa68b93e1a045dd38aa` | `356f45d31190d0f85570f4410cf989abe90e5fdd` | 待行为映射 | — |
| `docs/rewrite/README.md` | `72f2c319f258a9cf6df6cca19f251cbe22b8a222` | `71b7ac1e63a07069eda1327e597891753bf21f65` | 待行为映射 | — |
| `docs/rewrite/wave2-tasks.md` | `61ea4e541fe347cfa6f67eda62ff4e2493ce2bd7` | `不存在` | 待行为映射 | — |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `16d9f94b3d3397db3a3f9d9cd4eec01bd4bca5aa` 创建引用，并核对 tree `6c3aa6637ecfb59a17c5fb779fe275842c431e1d`；本草案不执行恢复。
