# 有限 Windows 探针交接与截图下载路径

2026-10-25。初轮仅准备探针；现已收到 Core 修复 `53fe0f2d2744e557dab98bf2652ffa5fce644c25` 并完成独立后端定点复验，见 [复验报告](53fe0f2-core-revalidation.md)。**Windows 仍未执行，不据后端结果解除分发阻断**。保留 `037a07585078d4dfcd443a2cc4a237c88aed07a0` 的原复现与证据。新增生产代码仍为空；只改 Acceptance 测试和报告。

## 八个有限探针

执行：PowerShell 7 / Windows / 官方 .NET 10.0.402：

```powershell
./tests/Caiwu.Acceptance/Wpf/run.ps1 -OutputDirectory artifacts/independent-acceptance
```

| ID | 实际检查 |
|---|---|
| `WPF-LAYOUT` | 实际主窗口的凭证、期初、余额表逐个切页，全部保留 PNG。像素列不得收缩到声明宽度的 85% 以下且至少 55 DIP，星号列至少 100 DIP。JSON 记录实际列宽、表头和 DPI。只是最低布局门槛，原图仍需视觉审查。 |
| `WPF-INVALID-SAVE-RETAINS-INPUT` | 在真实编辑器的真实行模型填不平衡金额，触发实际 Save 按钮；断言窗口不关闭、有明确错误、摘要和金额保留、revision 不变。赋中文字符串不是 IME 操作。 |
| `WPF-MALFORMED-AMOUNT-REJECTED` | 借贷均填 `1,23`；触发实际 Save，必须明确拒绝、不关闭、不改变整个持久快照、不丢原始字符串。 |
| `WPF-RAPID-DOUBLE-SAVE-SINGLE-WRITE` | 向真实 Save 按钮发送四个原生 `SendInput` 鼠标事件，即 down/up/down/up；断言保存回调、凭证数、revision 都只增加一次。不向已关闭按钮对象再次人为 RaiseEvent，避免伪造物理连点缺陷。 |
| `WPF-SQLITE-BUSY-RETAINS-INPUT` | 真实 SQLite 连接持有写锁；真实 Save 处理器必须保留窗口、摘要及金额并显示错误，输出 PNG。 |
| `WPF-STALE-EDITOR-RETAINS-OPENING-TOKEN-AND-INPUT` | 保留实际编辑器的打开快照；另一个真实 SQLite 连接提交新值后，两次实际 Save 都必须拒绝、留窗、保留输入和原 token，完整快照不得变化。 |
| `WPF-POSTED-READONLY` | 真实已记账凭证打开后，分录只读、Save 不可用；实际 Save 方法也不能写 revision。 |
| `WPF-ACCOUNT-INVALID-RETAINS-INPUT` | 实际科目表单填三位编码，点实际默认按钮；必须保持表单可修改。 |

连点探针若不能获得前台、`SetCursorPos`/`SendInput` 不成功或五秒内没有到达 Save，会记录 `BLOCKED`。它没有声称物理键盘、IME 或原生文件对话框验收。关闭凭证后，探针暂时拦截 owner 的鼠标事件，避免第二次点击在 owner 上启动无关操作；凭证窗口自身的输入路由不变。

执行器最长 120 秒（可在 30–300 秒间指定）；超时终止自己的测试进程并输出 timeout JSON。任何 `FAIL`、`BLOCKED`、结果缺失、commit 不匹配或探针数不等于八项都返回非零，不包装为通过。清除旧结果再执行，记录 checkout commit 与生产 `src` tree SHA，防止把旧 JSON 当新证据。

CI 需由主协调在其 workflow 中显式调用此脚本并 `if: always()` 上传 `artifacts/independent-acceptance/**`；本任务没有修改 workflow、生产模块或根 solution。当前 `packaging/build.ps1` 扫描到这些 csproj 也不会替代实际运行此独立控制台探针。

本轮验证：官方 SDK 10.0.402，Linux 交叉编译成功，**0 warning / 0 error**。针对准确 53fe0f2 的八项探针交叉编译同样为 0 warning / 0 error。Windows 执行状态：**未执行，待主协调 Windows runner**。原来 18 项 console 基线结果不因增加探针而改写。

## 已成功的截图获取方式（无凭据）

推荐先直接读取已经提交到私有仓库的原始 PNG，主协调无需再经过遇到 403 的 Actions blob 重定向：

- 验收分支：`codex/independent-acceptance`，初次证据提交 `2c1d697bfd60548a72674db0359e0b66138d2db6`，PR #8。
- 原图目录：`tests/Caiwu.Acceptance/evidence/ci/verification/`。
- 四张原图：`voucher-list.png`、`trial-balance.png`、`opening-balances.png`、`posted-voucher.png`。
- `voucher-list.png` SHA256：`d22a98e5104a94016364656620bc5968a539d667c61927fce2d617d9d0cdf299`。
- `trial-balance.png` SHA256：`cd6f1a36fffdfe37e6322d6638c1c5b54e5cfc27b8671cfcf60951fbaee2224b`。
- 全部原图哈希和产物核验：`tests/Caiwu.Acceptance/evidence/ci/provenance.json`。

如需重新获取原 CI 包，**本验收实际成功的是 GitHub 连接器的 `github_download_workflow_artifact`**，参数：

```json
{"repo_full_name":"xhc144/caiwu-suite","artifact_id":12591076154,"file_name":"caiwu-windows-preview-2.zip"}
```

本会话工具完整名：`mcp__codex_apps__github_download_workflow_artifact`。官方 GitHub REST 资源为 `GET /repos/xhc144/caiwu-suite/actions/artifacts/12591076154/zip`。连接器在其服务端处理 GitHub 重定向，再返回可下载的临时 file reference；使用它新返回的 `structuredContent.download_url` 或 `structuredContent.file_uri.download_url` 下载。临时链接有时效，不要复用本轮旧链接；不需要输出 token、签名 URL 或改权限。

本轮 `gh run download` 直达 Azure blob 曾返回 HTTP 403；没有重试那个失败地址。连接器工具成功返回文件后，本地用标准 `urllib.request.urlretrieve` 获取其临时 file reference，外层 ZIP SHA256 为 `0d37cdbd08fe368e14d516b0836a9c11a352c70da1380036d0424262ad21c560`，与 API/job 日志一致；随后只解压和阅读自研产物，未执行 EXE。该方式不要求更改凭据、权限或访问限制；若连接器本身触发权限拒绝，应停止并报告，已入仓原图仍可用于本轮既有证据。
