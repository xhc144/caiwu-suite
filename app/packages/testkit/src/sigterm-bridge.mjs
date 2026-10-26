// 仅用于测试旧入口：在子进程内部调用真实 SIGTERM handler，禁止用 exit(0) 伪造关闭。
process.on('message', (message) => {
  if (!message || typeof message !== 'object' || message.type !== 'CAIWU_TEST_SHUTDOWN') return;
  if (process.listenerCount('SIGTERM') === 0) {
    console.error('测试关闭桥接：入口未安装 SIGTERM handler');
    process.send?.({ type: 'CAIWU_TEST_SHUTDOWN_REJECTED', reason: 'missing SIGTERM handler' });
    return;
  }
  process.emit('SIGTERM', 'SIGTERM');
});
