import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';

function child(code: string, dataDir: string) {
  const process = spawn(
    globalThis.process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env, CAIWU_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '';
  for (const stream of [process.stdout, process.stderr])
    stream!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
  const exited = new Promise<number | null>((resolve, reject) => {
    process.once('exit', resolve);
    process.once('error', reject);
  });
  const ready = new Promise<{ bookId: string; protectionId: string; code?: string }>(
    (resolve, reject) => {
      let received = false;
      process.once('message', (message) => {
        received = true;
        resolve(message as { bookId: string; protectionId: string; code?: string });
      });
      process.once('exit', () => {
        if (!received) reject(new Error(output || '合成恢复子进程提前退出'));
      });
      process.once('error', reject);
    },
  );
  return { process, exited, ready };
}

it('w_hf：替换尚未验证即崩溃时重启拒绝旧运行锁，保护副本与维护标记保留且不自动解封', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-restore-crash-'));
  const applying = child(
    `
    import { createRuntime } from '@caiwu/server-kit';
    import { createHash } from 'node:crypto';
    try {
      const app = createRuntime({ dataDir: process.env.CAIWU_DATA_DIR, modules: [], devMode: true });
      await app.lifecycle.start();
      const info = await app.bookStore.create({
        name: '合成崩溃测试', orgName: '备份中的单位', templateId: 'demo-enterprise',
        product: 'qingsong', startYear: 2026, startMonth: 1, adminPassword: 'synthetic-password',
      });
      const raw = app.bookStore.open(info.id).raw;
      const bytes = raw.serialize();
      raw.prepare('UPDATE book_info SET org_name=? WHERE id=1').run('必须保护的当前单位');
      const ticket = await app.bookStore.prepareReplacement({
        bookId: info.id, bytes, length: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        expectedRevision: app.bookStore.revision(info.id), expiresAt: Date.now() + 60000,
      });
      await app.bookStore.maintain(info.id, {
        kind: 'replace', replacementId: ticket.replacementId,
        validate: async () => {
          const status = app.bookStore.replacementStatus(ticket.replacementId);
          process.send({ bookId: info.id, protectionId: status.protectionId });
          await new Promise(() => setInterval(() => {}, 1000));
        },
      });
    } catch (error) { console.error(error); process.exit(1); }
  `,
    dataDir,
  );
  try {
    const { bookId, protectionId } = await applying.ready;
    expect(protectionId).toEqual(expect.any(String));
    applying.process.kill('SIGKILL');
    expect(await applying.exited).toBeNull();
    const marker = path.join(dataDir, '.caiwu-runtime.lock', 'maintenance.json');
    expect(existsSync(marker)).toBe(true);
    const protection = path.join(dataDir, 'core-protection', bookId, `${protectionId}.caiwu`);
    const bytes = readFileSync(protection);
    expect(JSON.parse(readFileSync(`${protection}.json`, 'utf8'))).toMatchObject({
      bookId,
      length: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const raw = new Database(protection, { readonly: true, fileMustExist: true });
    try {
      expect(raw.prepare('SELECT book_id,org_name FROM book_info WHERE id=1').get()).toEqual({
        book_id: bookId,
        org_name: '必须保护的当前单位',
      });
      expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      raw.close();
    }
    const restarted = child(
      `
      import { createRuntime } from '@caiwu/server-kit';
      try {
        createRuntime({ dataDir: process.env.CAIWU_DATA_DIR, modules: [] });
        process.send({ code: 'UNEXPECTED_ADMISSION' });
      } catch (error) { process.send({ code: error.data?.code }); }
    `,
      dataDir,
    );
    try {
      expect(await restarted.ready).toMatchObject({ code: 'DATA_DIR_IN_USE' });
      expect(await restarted.exited).toBe(0);
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(protection)).toEqual(bytes);
    } finally {
      if (restarted.process.exitCode === null && restarted.process.signalCode === null) {
        restarted.process.kill('SIGKILL');
        await restarted.exited;
      }
    }
  } finally {
    if (applying.process.exitCode === null && applying.process.signalCode === null) {
      applying.process.kill('SIGKILL');
      await applying.exited;
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
