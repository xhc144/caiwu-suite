# caiwu 新版（app/）

单机财务软件的新版实现，覆盖原版轻松会计、民非企会计、成本会计三套产品，只有一个程序，三套产品是"产品形态"开关。

- 开发规则、目录、写法、测试：见仓库根目录的 [AGENTS.md](../AGENTS.md)
- Codex 云环境配置：[CODEX_SETUP.md](CODEX_SETUP.md)
- 示范模块：[modules/example](modules/example/README.md)

```sh
pnpm install
pnpm dev            # 开发：http://localhost:5173（开发模式会显示示范模块和演示科目表）
pnpm check          # 全部检查
pnpm desktop:build  # 打包 Electron 主进程和本地服务（安装包由桌面壳任务完善）
```

## 架构一览

```
浏览器 / Electron 窗口
  └─ apps/web（React 壳 + 各模块 web/）── tRPC over HTTP（127.0.0.1 + 启动令牌）──┐
                                                                               ▼
apps/server（Fastify）→ server-kit（会话、权限、模块登记）→ 各模块 server/ → core 服务 → SQLite（一个账套一个文件）
```

- 模块在 `modules/<id>/` 下，自动发现，互不 import，只通过 core 服务和路由交互。
- 核心服务保证凭证的完整性：借贷平衡、末级科目、辅助核算必填、期间未结账、来源单据保护、乐观锁、操作日志。
- 余额查询可以直接跨年（年结前上年期末自动作为下年期初），并支持辅助核算、外币、数量、本年累计。
