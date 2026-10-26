import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { backupRouter } from './router';
import { waitForJobs } from './service';
import { startAutomaticBackups, stopAutomaticBackups, beforeAutomaticBookClose } from './automatic';
export default defineServerModule(manifest, {
  router: backupRouter,
  migrations,
  lifecycle: {
    start: ({ app, signal }) => startAutomaticBackups(app, signal),
    beforeBookClose: async ({ app, book, signal, reason }) => {
      if (reason === 'close') await beforeAutomaticBookClose(app, book.id);
      await waitForJobs(app, book.id, signal);
    },
    stop: ({ app, signal }) => stopAutomaticBackups(app, signal),
  },
});
