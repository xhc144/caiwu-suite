# 交付组件验收记录

2026-10-25，在 `codex/windows-delivery` 的 Linux 工作区实际执行：**80 passed / 0 failed / 0 skipped**。SDK 为仓库锁定的 .NET SDK 10.0.402，运行时 .NET 10.0.13。NuGet locked restore 成功；测试程序退出码 0；报告 `artifacts/delivery-tests.json` 已回读核对。

```bash
./tools/dotnet-local.sh restore tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj --locked-mode
./tools/dotnet-local.sh run --project tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj -c Release --no-restore -- artifacts/delivery-tests.json
```

Windows 已有锁定 SDK 时，可将 `./tools/dotnet-local.sh` 换成 `dotnet`。这是独立控制台测试，不需要新增测试框架包；任一失败返回非零退出码。最后一个参数可选，指定逐项 JSON 报告路径。所有账套均在新的唯一临时目录中创建；HTTP 使用注入的本地 handler，不会请求真实更新服务。

## 已检查的行为

- 程序目录、账套目录和临时 payload 的分离；路径穿越、Windows 设备名、尾点/尾空格、符号链接和大小写碰撞拒绝。
- 清单来源 commit、文件 SHA256 与长度；篡改、缺失、多余文件和误装入账套文件拒绝。
- 首次安装和基于合成账套的同 schema 升级；缺失 Desktop 数据契约、缺失/遗漏/越界清单、降级、篡改 payload、安装租约和全局数据租约均阻止激活。
- 激活指针缺失时要求恢复；更换安装根、卸载后换版本或复用相同版本号装入不同 payload 均不能绕过账套保护。卸载后允许在原根重新安装相同不可变 payload。
- 卸载仅移除程序管理内容；目录外账套、备份、未知文件及被用户改动的程序文件保留。
- 真实 SQLite 备份 API：备份后完整性和独立已知金额核对，包含未 checkpoint 的已提交 WAL 内容；迁移仅操作副本，抛错或返回损坏副本均保留源文件 SHA256 和可恢复备份。
- 连续两次升级不会把受保护备份误判为未登记账套。
- 更新规则检查禁用状态、HTTPS、精确主机白名单、发布者证书指纹、版本递增、完整 SHA256 和大小。
- 离线 HTTP 检查 302 拒绝、无 Content-Length 的过大 feed、无更新时的结构校验；下载的坏 SHA256、截断、超长和取消会清理自身临时文件并保留无关文件。成功下载仍为 `.untrusted`，不会执行。

测试曾复现一个目录边界缺口：持久账套根处于临时 payload 内时可被激活。实现补上双向包含检查后，此回归通过。后续审阅发现激活指针缺失或改用新安装根可被当成首次安装；主协调补上持久数据目录凭据后，新增的 6 项恢复/重装回归均已通过。此前也通过 review 修正了“当前版本 feed 在 SHA256/大小检查前返回”和“备份回执从备份实际内容回读”的证据问题。

## 验收边界

安装算法测试使用不可执行的合成 payload；这不证明 Windows 安装器界面、开始菜单/ARP 注册、WPF 启动或实际卸载器运行成功。Linux 的结果不替代 Windows CI，也不证明 Authenticode 信任链、签名包发布、可信更新服务或人工键盘/打印验收完成。

同 schema 升级成功用例显式使用合成的 `managedDataContract=true` 和完整合成清单，只验证组件协议。当前真实 Desktop 没有接入完整数据清单和统一租约时，实际升级应继续阻断；不能为了通过验收修改生产清单标记。迁移副本验证没有实现生产数据库原地迁移或任意 schema 回退。

Windows 无符号链接权限或文件系统不能表示大小写碰撞时，相应用例会明确记录 `skipped`；测试不会更改系统安全设置。签名正向验收需由主协调在已有可信签名设施和发布通道可用后单独补充；本测试不生成证书、密钥或替代信任。
