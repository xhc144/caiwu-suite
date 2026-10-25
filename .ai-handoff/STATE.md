# caiwu-suite 本地开发交接

2026-10-25；项目路径 `/workspace/caiwu-suite-dev`。本轮将从原main创建 `codex/windows-mvp`，不改main。

- 已授权：本地自研、测试、本地提交；用户同意适量并行Codex任务。后续已明确同意指定私有仓库的开发分支push和草稿PR；远端先核状态防重复。主集成暂不另开子任务，交由根统一安排另外两个实现任务。
- 禁止：运行原安装器/激活程序；复制原代码/图标/图片；更改其他挂载仓库；公开发布、改main或权限。最初远端操作被拒绝未执行，此后有用户对该确切动作的新增明确授权；若仍拒绝停止。
- 本轮已完成：创建 `docs/IMPLEMENTATION_CONTRACT.md` v1，落地 `Caiwu.Contracts` DTO/接口、WPF `Caiwu.Desktop` 骨架、solution和SDK锁定；三块ownership已明确。
- 工具链核实：初始无SDK/MSBuild/Wine；本轮已安装官方.NET SDK10.0.402并校验SHA512，`dotnet --info`成功。当前Linux容器不能实机验收WPF交互。
- 官方.NET10元数据：SDK10.0.402、运行时10.0.13，支持至2028-11-14；下载地址/官方SHA512在 `docs/sdk-metadata.json`。
- 根提供规则ZIP已materialize成功、Library身份xattr正确；三份Markdown全部UTF-8可读，路径见契约末节。已读取不可逆记账/民非2026/企业未来分阶段与征求稿边界相关条目。
- 构建：首次被NuGet用户锁目录只读阻断；请求临时 `/home/agent/.dotnet` 写入后，被自动审批以仍受最初仅调查限制为由拒绝，未执行。拒绝原文在 `docs/BUILD_STATUS.md`，没有绕过或重试。
- 后续根传回明确开工证据，按允许重试一次后已获执行，但物理挂载仍只读。工作区缓存/NuGet.Config/直接MSBuild仍在NuGet-Migrations失败；没有改HOME或安全设置。
- 本轮继续：7个WPF工作页、账套/科目对话框、凭证编辑器（F4/F7/Enter）、打印与CSV、数据会话已写；13项纯界面逻辑检查通过。后端尚待两独立任务接入，App当前仍为未接入状态，不声称可用闭环。
- 当前.NET SDK自带csc能直接编译运行不依赖NuGet的纯C#测试。整套WPF构建将交由开发分支Windows CI验证。
- 修复结果：在任何dotnet进程前设置工作区XDG_RUNTIME_DIR（权限700）后，锁与还原成功，不需改HOME/宿主权限。`tools/dotnet-local.sh`记录完整可复用配置。
- 已cherry-pick SQLite d69a8b7→本分支5b32cbb，Core c499a4d→本分支70034e3；App组合根已连接真实模块。完整WPF Release交叉构建0警告0错误，Core53、SQLite63、界面13、真实SQLite/Core集成9全部通过。
- 待验证：开发分支Windows CI的WPF窗口实际运行/渲染和预览包；人工键盘/打印/高DPI验收未完成。首版不覆盖完整报表、年结、成本分配、电子凭证/完整认证，模板未经生产复核。
- 下一步：根把契约提交发送两个实现任务；根处理最新开工授权与构建审批冲突。核心与SQLite各按独占目录实现，返回代码及测试证据后集成。UI选择已改为.NET10 WPF，业务/存储不受影响。
- 状态：公共接口与UI骨架已写但未编译；实际记账能力尚未实现；Windows实机验证未完成；任何财务正确性/合规性未验证。
