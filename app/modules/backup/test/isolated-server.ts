import type { RuntimeHookContext } from '@caiwu/server-kit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';

/** 手动作业测试固定前提：不调度自动任务，保留真实路由、迁移及关闭排空。生产 hook 另做集成测试。 */
export default {
  ...backupServer,
  lifecycle: {
    beforeBookClose: backupServer.lifecycle!.beforeBookClose,
    stop: ({ app, signal }: RuntimeHookContext) => waitForJobs(app, undefined, signal),
  },
};
