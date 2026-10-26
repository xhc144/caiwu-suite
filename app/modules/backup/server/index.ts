import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { backupRouter } from './router';
import { waitForJobs } from './service';
export default defineServerModule(manifest, {
  router: backupRouter,
  migrations,
  lifecycle: {
    beforeBookClose: ({ app, book, signal }) => waitForJobs(app, book.id, signal),
    stop: ({ app, signal }) => waitForJobs(app, undefined, signal),
  },
});
