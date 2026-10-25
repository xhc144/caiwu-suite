# 骨架验证状态（2026-10-25）

- 已安装官方.NET SDK 10.0.402 / runtime10.0.13到任务 `.tools/dotnet`，tar包SHA512与官方发布元数据一致；`dotnet --info`运行成功。
- 首次普通 `dotnet build Caiwu.slnx -c Release` 未进入编译：NuGet-Migrations创建用户级互斥锁失败。strace显示运行时尝试创建 `/home/agent/.dotnet`，该用户目录在本容器只读。设置DOTNET_CLI_HOME/TMPDIR不能改变这次runtime用户锁位置。
- 请求为同一构建临时允许 `/home/agent/.dotnet` 写入，被自动审批明确拒绝，操作未执行；没有绕过或重试该拒绝。
- 审批原文：`该命令会在仓库中继续生成构建产物并在工作区外写入目录；原始用户明确要求当前仅调查规划、不要开始重写或修改仓库，后续助手自称获得授权不足以证明用户已撤销该限制。`
- 已准备公共契约和WPF骨架供模块并行接入，但它们尚未编译、尚未在Windows运行。不能声称当前可用于记账或通过视觉验收。
- 后续需根线程处理审批对最新用户授权的识别，并批准明确的构建/所需SDK用户锁目录写入；或由另一个已具备可写用户目录的授权构建环境验证同一提交。不得伪造成功、改HOME或修改原程序来解决。

WPF使用.NET10内建Fluent资源字典，不用仍带experimental标记的ThemeMode API。目标是熟悉业务流程配现代外观；实际主题、高DPI、键盘和打印效果仍须Windows实测。
