# testkit 子进程关闭夹具

- `local-server` 只把已发送协议请求后的零码退出且 stdout/stderr 全部 close 视为正常关闭；默认关闭预算 5 秒，失败回收预算 2 秒，失败保留临时目录。
- `shutdown-server.mjs` 的 stdio 孙进程显式 detached，使 Windows 父进程退出后仍能持有继承句柄；`.unref()` 本身不会脱离 libuv 的 Windows Job。原 `FINAL_STDIO` 断言保留，并校验 exit → FINAL_STDIO → close → close promise 完成。
- `node packages/testkit/test/fixtures/stdio-probe.mjs` 保留非 detached 反例及握手对照，以本机 TCP 事件释放输出，记录两代子进程的 exit/data/close 和孙进程实际退出；不使用睡眠驱动诊断。
- `pnpm exec vitest run packages/testkit/test/local-server.test.ts` 覆盖失败退出、原 150ms 超时、IPC 失败、重复关闭、目录保留、端口回收与无关进程存活。

未完成：本切片不验证桌面安装、更新、回滚或完整预览验收；Windows 结果须按 PR 对应 head 和 job 检查。
