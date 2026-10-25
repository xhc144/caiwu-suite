# caiwu-suite 单机财务软件套件

自主开发的单机版财务软件，参考市面上同类产品的功能和操作习惯，重新设计实现（不使用原软件的代码、图标和图片）。

## 计划中的产品线

| 产品 | 参考对象 | 适用会计制度 |
|---|---|---|
| 轻松会计 | 轻松会计单机版 | 企业会计准则 / 小企业会计准则 |
| 民非企会计 | 民非企单机版 | 民间非营利组织会计制度 |
| 成本会计 | 成本会计单机版 | 企业成本核算 |

## 技术选型（暂定）

- C# .NET 10 LTS + WPF（现代桌面外观，保留熟悉的菜单、凭证表格与键盘流程）
- SQLite（单文件账套，便于备份）

## 参考资料

原版安装包放在本仓库的 Release「reference-installers」中，仅供内部研究对照，**不得公开分发**。仓库请保持私有。

## 开发状态

当前为实验首版：已接入真实SQLite账套、科目/期初、凭证保存、审核、不可逆记账、余额与明细联查、备份恢复；另有CSV与Windows打印入口。不能用于未经验收的正式生产账务，未声称符合任何完整财务制度或完成原版专用界面的实机验证。

工程职责与API契约见 [docs/IMPLEMENTATION_CONTRACT.md](docs/IMPLEMENTATION_CONTRACT.md)。UI、账务领域和SQLite存储互相隔离。使用.NET SDK 10.0.402；构建命令：

```sh
dotnet build Caiwu.slnx -c Release
```

Linux可以还原Windows引用包并交叉编译，实际桌面操作、打印和安装仍须Windows验收。

Linux只读用户目录环境可用 `tools/dotnet-local.sh`。它把SDK缓存和XDG运行目录放在本项目`.tools`，不改HOME或宿主权限。2026-10-25集成验证：完整Release构建0警告/0错误；Core 53、SQLite 63、界面逻辑13、真实SQLite集成9项全部通过。Windows CI另执行自研WPF窗口渲染、输出实际界面PNG并打包；未完成的CI不能算Windows验收通过。

Windows构建、测试和生成自包含预览ZIP：`./packaging/build.ps1`。产物不包含原软件资产；安装脚本不生成签名、不需要管理员权限。模板全部标为试用/实验，不包含完整财务报表、年结、成本核算、原账套迁移或电子凭证完整流程。
