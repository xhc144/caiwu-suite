// 故障子进程退出后由父测试清理；不绕过生产失败关闭门释放目录。
import { createRuntime } from '@caiwu/server-kit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';

const app = createRuntime({ dataDir: process.argv[2]!, modules: [backupServer], devMode: true });
const info = await app.bookStore.create({
  name: '启动终态失败',
  orgName: '合成单位',
  templateId: 'demo-enterprise',
  product: 'chengben',
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'admin',
});
const book = app.bookStore.open(info.id);
const real = book.raw.backup.bind(book.raw);
let entered!: () => void, release!: () => void;
const started = new Promise<void>((resolve) => {
  entered = resolve;
});
const blocked = new Promise<void>((resolve) => {
  release = resolve;
});
book.raw.backup = async (...args) => {
  entered();
  await blocked;
  const result = await real(...args);
  book.raw.exec(
    "CREATE TRIGGER backup_startup_final_log_failure BEFORE INSERT ON operation_log WHEN NEW.action IN ('backup.complete','backup.failed') BEGIN SELECT RAISE(FAIL, '合成启动终态不可写'); END;",
  );
  return result;
};
await app.lifecycle.start();
const startState = app.lifecycle.state;
await started;
release();
const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error.message,
  );
const jobError = await rejected(waitForJobs(app));
const closeError = await rejected(app.bookStore.close(info.id));
const stopError = await rejected(app.lifecycle.stop());
console.log(
  JSON.stringify({
    startState,
    jobError,
    closeError,
    stopError,
    state: app.lifecycle.state,
    rawOpen: book.raw.open,
    item: book.raw.prepare('SELECT status,reason FROM backup_item').get(),
    logs: book.raw
      .prepare(
        "SELECT action,user_id,user_name FROM operation_log WHERE action LIKE 'backup.%' ORDER BY id",
      )
      .all(),
  }),
);
