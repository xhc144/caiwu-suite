# worker/w2-desktop-updates-20261026

状态：仅本地归档草案；批次 01；未发布、未创建归档提交、未删引用。

- 原名称：`worker/w2-desktop-updates-20261026`
- head：`f5f1616837c21783cc7cd0af19f2ac48aba8c70e`
- tree：`cf0535979122278fc5ebd2cb8f8d76e584dea33a`
- 原提交父节点：`90c573f11f7803d4424a1775fc752b6d4084eeac`
- 冻结时 ref 未移动，且没有 open PR；这些观察不代替未来发布前复读。
- 历史入口：[固定提交树](https://github.com/xhc144/caiwu-suite/tree/f5f1616837c21783cc7cd0af19f2ac48aba8c70e)

## 与固定 main 的比较

固定 main：`dd4df52d9a70033f24630c5074755c8419a857c8`；tree：`7e06d17ea0d6b6483e4266ddcc52216c6d62cf60`。

connector compare：`diverged`，ahead_by=9，behind_by=181；merge-base=`c53bf14cde552acc83dd7b15b575c918bb5e3b88`。这些是提交历史差异数，不代表功能缺口数。

普通 app/docs owned 路径 19 条；当前 main 相同 0 条；当前或 main 历史同路径命中 0 条。不同 blob 的业务意义尚未审结。

## 未审范围

- `.github/workflows/app-windows.yml`：仅知道比较元数据中的路径，未读取该旧版本内容；不作采用或批准结论。
- 未读取或复制禁止的旧目录、原安装资源、秘密或原始数据。
- 未运行测试。原分支 README/PR 的未完成项继续保留于冻结提交，不因归档转为完成。

## 逐路径元数据

表中仅记录 Git 对象标识，不复制旧源码。`相同`表示 head blob/mode 与固定 main 一致；其余只表示仍需行为映射。

| 路径 | head blob | main blob | 对照 | main 历史同路径见证 |
|---|---|---|---|---|
| `app/apps/desktop/README.md` | `1b80f3aa688230a846b7e4c9d847cd693e4c0797` | `bb769b05aa9c9aa03840a8ad849877d681e27e62` | 待行为映射 | — |
| `app/apps/desktop/build.mjs` | `b0e7e80968c3175c22e4e92f65c279b0855dc330` | `2cf301bec394604b0ea06d0dc39285d0f4f45557` | 待行为映射 | — |
| `app/apps/desktop/build/installer.nsh` | `ab6704feb9bd0fc979a8deb497d8c6971bc7a497` | `b48d7c3c5dc9c1d4af471d2714e489e967ae223e` | 待行为映射 | — |
| `app/apps/desktop/build/update-manifest.mjs` | `39f4e71f6e301b2299ebb21231782f1f81760028` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/package.json` | `f499ac05f897fbc115df44b2a4f1714cb2b81a58` | `d1047b92eef3db03bdc5bdba7dc8cdc51a8d8e38` | 待行为映射 | — |
| `app/apps/desktop/qa/desktop.e2e.ts` | `aacc185d0aebb8aecd578217f9c9199932bed36b` | `1ed91b81cf95a8260a40b47c13029957f4b1e374` | 待行为映射 | — |
| `app/apps/desktop/qa/handoff.playwright.config.ts` | `4d7a5bf4d15f4d5b2fb706f0a490dd7c2b965889` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/qa/prepare-fixture.ts` | `ed2ec51c84e8aa806f810a97330e1a4fd37129b7` | `a4160b50a56a5e604ef73decd008e11246a87248` | 待行为映射 | — |
| `app/apps/desktop/qa/update-checks.ts` | `cbd61d892bbe9a85141a40538b0a4b978daf3336` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/qa/update-handoff.spec.ts` | `3ace4327a11e58360468daee88ac9a0a86662277` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/qa/verify-update.ts` | `df89d9a0dc9407c2252a78019f50341ac69aa2b6` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/src/bridge.ts` | `3eb88a46f89309cb2b4ed423b998ff046b595864` | `1cb3196a0811275271d018b17460d01732eaa19c` | 待行为映射 | — |
| `app/apps/desktop/src/main.ts` | `1b57e68db0f15457c990a349e65efd42d5cd5abb` | `25952a1edeccc00d56d8fc609d38c15f0436232b` | 待行为映射 | — |
| `app/apps/desktop/src/preload.ts` | `e5afe92f48d3e53a7c80eaceebfbd5ae25829d0d` | `18f574d85098233900bd5d2e0dca7ec3c9c6180c` | 待行为映射 | — |
| `app/apps/desktop/src/test/update-backup.test.ts` | `997e254636fa344a60ae545a5e19aaf2a73e4df2` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/src/test/updates.test.ts` | `0e2db3e84a43a6c52a008fd5008e202c5b007400` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/src/update-backup.ts` | `a7e11dba85f7412f26593c5a84317ecca99422c1` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/src/updates.ts` | `267da2bb479140d90324f366d666078252ebb46a` | `不存在` | 待行为映射 | — |
| `app/apps/desktop/tsconfig.qa.json` | `d9e19f540eabc2c5a49fd451c485cffa759593f2` | `不存在` | 待行为映射 | — |

## 归档与恢复边界

拟把本 head 作为对应归档提交的额外 parent。归档提交的 tree 来自发布时实际 main，只追加归档 docs。本旧树不会覆盖 main；此记录不声明功能已集成或验收通过。

未来若需恢复引用，在另行授权后以原名称和 head `f5f1616837c21783cc7cd0af19f2ac48aba8c70e` 创建引用，并核对 tree `cf0535979122278fc5ebd2cb8f8d76e584dea33a`；本草案不执行恢复。
