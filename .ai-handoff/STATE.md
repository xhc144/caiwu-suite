# caiwu-suite 本地开发交接

2026-10-25；项目路径 `/workspace/caiwu-suite-dev`。本轮将从原main创建 `codex/windows-mvp`，不改main。

- 已授权：本地自研、测试、本地提交；用户同意适量并行Codex任务。后续已明确同意指定私有仓库的开发分支push和草稿PR；远端先核状态防重复。主集成暂不另开子任务，交由根统一安排另外两个实现任务。
- 禁止：运行原安装器/激活程序；复制原代码/图标/图片；更改其他挂载仓库；公开发布、改main或权限。最初远端操作被拒绝未执行，此后有用户对该确切动作的新增明确授权；若仍拒绝停止。
- 本轮已完成：创建 `docs/IMPLEMENTATION_CONTRACT.md` v1，落地 `Caiwu.Contracts` DTO/接口、WPF `Caiwu.Desktop` 骨架、solution和SDK锁定；三块ownership已明确。
- 工具链核实：初始无SDK/MSBuild/Wine；本轮已安装官方.NET SDK10.0.402并校验SHA512，`dotnet --info`成功。当前Linux容器不能实机验收WPF交互。
- 官方.NET10元数据：SDK10.0.402、运行时10.0.13，支持至2028-11-14；下载地址/官方SHA512在 `docs/sdk-metadata.json`。
- 根提供规则ZIP已materialize成功、Library身份xattr正确；三份Markdown全部UTF-8可读，路径见契约末节。已读取不可逆记账/民非2026/企业未来分阶段与征求稿边界相关条目。
- 构建：首次被NuGet用户锁目录只读阻断；请求临时 `/home/agent/.dotnet` 写入后，被自动审批以仍受最初仅调查限制为由拒绝，未执行。拒绝原文在 `docs/BUILD_STATUS.md`，没有绕过或重试。
- 下一步：根把契约提交发送两个实现任务；根处理最新开工授权与构建审批冲突。核心与SQLite各按独占目录实现，返回代码及测试证据后集成。UI选择已改为.NET10 WPF，业务/存储不受影响。
- 状态：公共接口与UI骨架已写但未编译；实际记账能力尚未实现；Windows实机验证未完成；任何财务正确性/合规性未验证。
