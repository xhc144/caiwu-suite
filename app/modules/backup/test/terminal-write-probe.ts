// 独立合成进程验证不可保存最终日志时的拒绝关闭；进程自然退出后由父测试删除临时目录。
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { buildAppRouter, coreRouter, createRuntime } from '@caiwu/server-kit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';

const app = createRuntime({ dataDir: process.argv[2]!, modules: [backupServer], devMode: true });
const router = buildAppRouter(app);
const caller = coreRouter.createCaller({ app, token: null });
const created = (await caller.books.create({
  name: '最终日志故障',
  orgName: '合成单位',
  templateId: 'demo-enterprise',
  product: 'chengben',
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'admin',
})) as { id: string };
const login = (await caller.auth.login({
  bookId: created.id,
  userCode: 'admin',
  password: 'admin',
})) as { token: string };
const raw = app.bookStore.open(created.id).raw;
const real = raw.backup.bind(raw);
let release!: () => void;
const finish = new Promise<void>((resolve) => {
  release = resolve;
});
raw.backup = async (...args) => {
  await finish;
  const result = await real(...args);
  raw.exec(
    "CREATE TRIGGER backup_fixture_final_log_failure BEFORE INSERT ON operation_log WHEN NEW.action IN ('backup.complete','backup.failed') BEGIN SELECT RAISE(FAIL, '合成最终日志不可写'); END;",
  );
  return result;
};
const http = createHTTPServer({ router, createContext: () => ({ app, token: login.token }) });
await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
const address = http.address();
if (!address || typeof address === 'string') throw new Error('HTTP 监听失败');
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/m.backup.create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), name: '最终写入故障' }),
  });
  if (response.status !== 200) throw new Error(`HTTP 未成功返回：${response.status}`);
  const body = (await response.json()) as { result: { data: { status: string } } };
  release();
  const rejectMessage = (task: Promise<unknown>) =>
    task.then(
      () => null,
      (error: Error) => error.message,
    );
  const jobError = await rejectMessage(waitForJobs(app));
  let prepared = false;
  const maintenanceError = await rejectMessage(
    app.bookStore.maintain(created.id, {
      kind: 'reconnect',
      prepare: async () => {
        prepared = true;
      },
    }),
  );
  const closeError = await rejectMessage(app.bookStore.close(created.id));
  const stopError = await rejectMessage(app.lifecycle.stop());
  const evidence = {
    responseStatus: body.result.data.status,
    jobError,
    maintenanceError,
    closeError,
    stopError,
    prepared,
    runtimeState: app.lifecycle.state,
    rawOpen: raw.open,
    item: raw.prepare('SELECT status, reason FROM backup_item').get(),
    logs: raw
      .prepare("SELECT action FROM operation_log WHERE action LIKE 'backup.%' ORDER BY id")
      .all(),
  };
  raw.exec('DROP TRIGGER backup_fixture_final_log_failure');
  raw.backup = real;
  raw
    .prepare(
      "INSERT INTO book_setting(scope,key,value,updated_at) VALUES('backup','repaired-commit','true',?)",
    )
    .run(new Date().toISOString());
  await waitForJobs(app);
  // Repeating the wait must not duplicate the recovered terminal audit entry.
  await waitForJobs(app);
  const recovered = raw.prepare('SELECT status, reason FROM backup_item').get();
  const recoveredLogs = raw
    .prepare("SELECT action,user_id,user_name FROM operation_log WHERE action='backup.failed'")
    .all();
  const file = app.bookStore.pathOf(created.id);
  await app.lifecycle.stop();
  const closed = new Database(file, { readonly: true });
  try {
    console.log(
      JSON.stringify({
        ...evidence,
        recovery: {
          item: recovered,
          logs: recoveredLogs,
          state: app.lifecycle.state,
          rawOpen: raw.open,
          newCommit: closed
            .prepare("SELECT value FROM book_setting WHERE key='repaired-commit'")
            .get(),
        },
      }),
    );
  } finally {
    closed.close();
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    http.close((error) => (error ? reject(error) : resolve())),
  );
}
