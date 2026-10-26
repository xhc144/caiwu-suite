// utilityProcess 通过专用消息请求 Fastify 正常关闭；不把 UI/数据或令牌带回主进程。
import '../../server/src/main';

process.parentPort?.on('message', ({ data }) => {
  if (data === 'caiwu:shutdown') process.emit('SIGTERM');
});

process.on('message', (data) => {
  if (data === 'caiwu:shutdown') process.emit('SIGTERM');
});
process.on('disconnect', () => process.emit('SIGTERM'));
