import { sessionStore } from '@caiwu/web-kit';
import type { BackupService } from '../server/service';
import { createBatchQueue } from './batch-queue';

export type Plan = Awaited<ReturnType<BackupService['preview']>>;
export const batchQueue = createBatchQueue<Plan>();
let token = sessionStore.get()?.token;
sessionStore.subscribe(() => {
  const next = sessionStore.get()?.token;
  if (next !== token) {
    token = next;
    batchQueue.reset();
  }
});
