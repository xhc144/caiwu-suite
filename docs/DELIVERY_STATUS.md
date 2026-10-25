# 实验首版交付状态（2026-10-25）

## 已完成

Windows CI [40172477245](https://github.com/xhc144/caiwu-suite/actions/runs/40172477245) 已成功终止，源码提交 `037a07585078d4dfcd443a2cc4a237c88aed07a0`。Windows构建、Core53/SQLite63/界面逻辑13/真实会话集成9检查均通过；自研WPF程序启动并实际生成四个PNG，验证JSON存在后才允许打包步骤成功。

官方Actions产物：[caiwu-windows-preview-2](https://github.com/xhc144/caiwu-suite/actions/runs/40172477245/artifacts/12591076154)，66553641字节，GitHub记录SHA256 `0d37cdbd08fe368e14d516b0836a9c11a352c70da1380036d0424262ad21c560`。这是Actions外层产物ZIP的元数据值，本任务没有成功下载其字节，不能冒充本地复算。

本任务另从相同自研生产源码本地交叉发布Windows自包含包（`src`相对上述CI提交diff为空）：

- 文件：`caiwu-preview-win-x64-fa8efc4-local.zip`
- 大小：64255749字节
- 本地SHA256：`7448865a334df50e54c9185064e96eee9d596fc1cbb7ae4a582d95a0e41fe4b6`
- 发布时提交：`fa8efc4577ed25c4b197c1f8d3a87bf6f702003a`，仅增加Core/SQLite集成探针，无生产源码变化。
- ZIP含414个文件，CRC检查通过；含Windows apphost、运行时、SQLite库、使用说明及逐文件哈希manifest，不含账套文件或原软件资产。
- 首版包未签名，不要求关闭安全策略；不是生产合规认证。

额外的Core+SQLite探针已在主集成环境重新编译运行，332条断言通过，结果保存在本任务 `artifacts/core-sqlite-probe-main/result.json`。该数是额外断言数，不冒充332个独立单元测试。

## 传输阻点

1. `gh run download`读取上述Actions产物时，授权GitHub接口重定向到 `productionresultssa18.blob.core.windows.net`，返回HTTP403 Forbidden，未下载字节。核对元数据确认产物存在且未过期；用官方API和no-cache取得新的授权跳转后仍403，目标文件0字节，不再盲重试或绕认证。截图尚未在本任务亲眼复核，不能声称视觉验收通过。
2. 使用当前Library技能的大文件prepared-upload助手保存本地64MB预览ZIP、试用说明和验证JSON时，在 `hosted apps tools/list` 阶段返回HTTP401。尚未prepare、传输或finalize；这三份文件均未得到Library ID，不能声称已保存。没有切换较宽松路径绕过该失败。文件仍完整保存在本任务工作区。

这两项是交付传输失败，不是WPF程序构建失败，也没有不确定的安装/执行结果。原界面研究包 `libfile_442a588c36dc8191bf833338100c9a0e` 仍为已确认的版本0、193504字节；没有把未成功写回的新资料当成已保存版本。

## 未验范围

人工键盘、真实打印机、高DPI、完整财务制度/报表、原软件子页相似度尚未完成验收。原界面证据统一入口为 [reference-ui/README.md](reference-ui/README.md)，后续实现及补证应引用page-id。
