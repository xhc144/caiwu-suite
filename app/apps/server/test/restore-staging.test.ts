import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';

let book: TestBook;
afterEach(async () => {
  vi.restoreAllMocks();
  await book?.store.dispose();
  await book?.close();
  vi.useRealTimers();
});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const raw = () => book.store.open(book.info.id).raw;
const file = (id: string) => path.join(book.dataDir, 'restore-staging', `${id}.sqlite`);
const protectionDir = () => path.join(book.dataDir, 'core-protection', book.info.id);
const protectionFiles = () =>
  existsSync(protectionDir())
    ? readdirSync(protectionDir()).filter((name) => name.endsWith('.caiwu'))
    : [];
const cancel = (id: string) =>
  book.store.cancelReplacement({ bookId: book.info.id, replacementId: id });
const stage = (bytes = raw().serialize(), expiresAt = Date.now() + 60_000) =>
  book.store.prepareReplacement({
    bookId: book.info.id,
    bytes,
    length: bytes.length,
    sha256: hash(bytes),
    expectedRevision: book.store.revision(book.info.id),
    expiresAt,
  });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('w_hf：重复取消只删除原票据暂存，之后同名文件和无关UUID文件不被删除', async () => {
  book = await createTestBook();
  const ticket = await stage();
  const revision = book.store.revision(book.info.id);
  const unknown = file(randomUUID());
  writeFileSync(unknown, '无关合成UUID文件');
  expect(cancel(ticket.replacementId)).toMatchObject({
    status: 'cancelled',
    stagingRetained: false,
    cleanupPending: false,
  });
  expect(existsSync(file(ticket.replacementId))).toBe(false);
  writeFileSync(file(ticket.replacementId), '后来创建的同名文件');
  expect(cancel(ticket.replacementId).status).toBe('cancelled');
  expect(readFileSync(file(ticket.replacementId), 'utf8')).toBe('后来创建的同名文件');
  expect(readFileSync(unknown, 'utf8')).toBe('无关合成UUID文件');
  await expect(
    book.store.maintain(book.info.id, { kind: 'replace', replacementId: ticket.replacementId }),
  ).rejects.toThrow(/不存在、已使用或过期/);
  expect(book.store.revision(book.info.id)).toBe(revision);
  expect(protectionFiles()).toEqual([]);
});

it('w_hf：期限到达自动清理，重复过期清理幂等且不改当前账套', async () => {
  book = await createTestBook();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const ticket = await stage(undefined, Date.now() + 1000);
  const revision = book.store.revision(book.info.id);
  await vi.advanceTimersByTimeAsync(1001);
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'expired',
    stagingRetained: false,
    cleanupPending: false,
  });
  expect(existsSync(file(ticket.replacementId))).toBe(false);
  expect(book.store.cleanupExpiredReplacements()).toEqual({ expired: 0 });
  expect(book.store.cleanupExpiredReplacements()).toEqual({ expired: 0 });
  expect(book.store.revision(book.info.id)).toBe(revision);
});

it('w_hf：时钟前移后的显式过期清理只处理本实例已到期票据', async () => {
  book = await createTestBook();
  vi.useFakeTimers({ toFake: ['Date'] });
  const expired = await stage(undefined, Date.now() + 1000);
  const prepared = await stage();
  vi.setSystemTime(Date.now() + 1001);
  expect(book.store.cleanupExpiredReplacements()).toEqual({ expired: 1 });
  expect(existsSync(file(expired.replacementId))).toBe(false);
  expect(existsSync(file(prepared.replacementId))).toBe(true);
  expect(book.store.replacementStatus(prepared.replacementId).status).toBe('prepared');
});

it('w_hf：目标绑定错误不能取消另一账套的票据', async () => {
  book = await createTestBook();
  const ticket = await stage();
  expect(() =>
    book.store.cancelReplacement({ bookId: randomUUID(), replacementId: ticket.replacementId }),
  ).toThrow(/不存在/);
  expect(book.store.replacementStatus(ticket.replacementId).status).toBe('prepared');
  expect(existsSync(file(ticket.replacementId))).toBe(true);
});

it('w_hf：应用中取消和到期清理均不能删除暂存，验证完成后才清理且保护备份保留', async () => {
  book = await createTestBook();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const ticket = await stage(undefined, Date.now() + 1000);
  const entered = deferred(),
    finish = deferred();
  const applying = book.store.maintain(book.info.id, {
    kind: 'replace',
    replacementId: ticket.replacementId,
    validate: async () => {
      entered.resolve();
      await finish.promise;
    },
  });
  await entered.promise;
  try {
    expect(() => cancel(ticket.replacementId)).toThrow(/正在应用/);
    await vi.advanceTimersByTimeAsync(1001);
    expect(book.store.cleanupExpiredReplacements()).toEqual({ expired: 0 });
    expect(book.store.replacementStatus(ticket.replacementId).status).toBe('applying');
    expect(existsSync(file(ticket.replacementId))).toBe(true);
  } finally {
    finish.resolve();
    await applying;
  }
  expect(existsSync(file(ticket.replacementId))).toBe(false);
  const protection = protectionFiles();
  expect(protection).toHaveLength(1);
  const before = readFileSync(path.join(protectionDir(), protection[0]!));
  expect(cancel(ticket.replacementId).status).toBe('done');
  expect(readFileSync(path.join(protectionDir(), protection[0]!))).toEqual(before);
});

it('w_hf：维护排空尚未开始应用时可取消，排空后不能继续执行被取消票据', async () => {
  book = await createTestBook();
  const ticket = await stage();
  const release = deferred();
  const held = book.store.withBook(book.info.id, async () => release.promise);
  const applying = book.store.maintain(book.info.id, {
    kind: 'replace',
    replacementId: ticket.replacementId,
  });
  const rejected = expect(applying).rejects.toThrow(/不存在、已使用或过期/);
  try {
    expect(cancel(ticket.replacementId).status).toBe('cancelled');
    expect(existsSync(file(ticket.replacementId))).toBe(false);
  } finally {
    release.resolve();
    await held;
    await rejected;
  }
  expect(protectionFiles()).toEqual([]);
});

it('w_hf：目标版本不符的失败票据清理暂存，原账及保护目录不变', async () => {
  book = await createTestBook();
  const ticket = await stage();
  raw().prepare("UPDATE book_info SET org_name='目标已变化' WHERE id=1").run();
  await expect(
    book.store.maintain(book.info.id, { kind: 'replace', replacementId: ticket.replacementId }),
  ).rejects.toThrow(/目标账套已变化/);
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'failed',
    stagingRetained: false,
  });
  expect(existsSync(file(ticket.replacementId))).toBe(false);
  expect(raw().prepare('SELECT org_name FROM book_info').pluck().get()).toBe('目标已变化');
  expect(protectionFiles()).toEqual([]);
});

it('w_hf：恢复失败但回滚验证成功后清理暂存，释放目录仍保留完整保护副本', async () => {
  book = await createTestBook();
  const bytes = raw().serialize();
  raw().prepare("UPDATE book_info SET org_name='必须回滚的当前账' WHERE id=1").run();
  const ticket = await stage(bytes);
  await expect(
    book.store.maintain(book.info.id, {
      kind: 'replace',
      replacementId: ticket.replacementId,
      validate: async () => {
        throw new Error('合成验证失败');
      },
    }),
  ).rejects.toThrow('合成验证失败');
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'failed',
    stagingRetained: false,
  });
  expect(raw().prepare('SELECT org_name FROM book_info').pluck().get()).toBe('必须回滚的当前账');
  const protection = path.join(protectionDir(), protectionFiles()[0]!);
  const before = readFileSync(protection);
  await book.store.dispose();
  expect(readFileSync(protection)).toEqual(before);
  expect(existsSync(file(ticket.replacementId))).toBe(false);
});

it('w_hf：回滚尚未完成时仍是applying，取消不能提前删除隔离诊断可能需要的暂存', async () => {
  book = await createTestBook();
  const ticket = await stage();
  const entered = deferred(),
    finish = deferred();
  const original = Database.prototype.backup;
  const spy = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (
    this: Database.Database,
    target,
    options,
  ) {
    if (this.name.includes('core-protection')) {
      entered.resolve();
      await finish.promise;
    }
    return original.call(this, target, options);
  });
  const restoring = book.store.maintain(book.info.id, {
    kind: 'replace',
    replacementId: ticket.replacementId,
    validate: async () => {
      throw new Error('合成拒收');
    },
  });
  const rejected = expect(restoring).rejects.toThrow('合成拒收');
  await entered.promise;
  try {
    expect(book.store.replacementStatus(ticket.replacementId).status).toBe('applying');
    expect(() => cancel(ticket.replacementId)).toThrow(/正在应用/);
    expect(existsSync(file(ticket.replacementId))).toBe(true);
  } finally {
    finish.resolve();
    await rejected;
    spy.mockRestore();
  }
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'failed',
    stagingRetained: false,
  });
});

it('w_hf：回滚不确定的隔离票据保留暂存供诊断，修复解封后显式取消才可删除，保护副本始终保留', async () => {
  book = await createTestBook();
  const ticket = await stage();
  const original = Database.prototype.backup;
  const spy = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (
    this: Database.Database,
    target,
    options,
  ) {
    if (this.name.includes('core-protection')) throw new Error('合成回滚IOERR');
    return original.call(this, target, options);
  });
  try {
    await expect(
      book.store.maintain(book.info.id, {
        kind: 'replace',
        replacementId: ticket.replacementId,
        validate: async () => {
          throw new Error('合成拒收');
        },
      }),
    ).rejects.toThrow(/已隔离/);
    expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
      status: 'failed',
      stagingRetained: true,
    });
    expect(() => cancel(ticket.replacementId)).toThrow(/隔离修复/);
    expect(book.store.cleanupExpiredReplacements()).toEqual({ expired: 0 });
    expect(existsSync(file(ticket.replacementId))).toBe(true);
  } finally {
    spy.mockRestore();
    if (existsSync(book.store.pathOf(book.info.id) + '.quarantine.json'))
      await book.store.recoverQuarantined({
        bookId: book.info.id,
        bookName: book.info.name,
        adminCode: 'admin',
        password: 'admin',
      });
  }
  const protection = path.join(protectionDir(), protectionFiles()[0]!);
  const before = readFileSync(protection);
  expect(cancel(ticket.replacementId)).toMatchObject({ status: 'failed', stagingRetained: false });
  expect(readFileSync(protection)).toEqual(before);
});

it('w_hf：dispose清理未执行票据，未知UUID文件和用户普通文件不扫描删除', async () => {
  book = await createTestBook();
  const ticket = await stage();
  const unknown = file(randomUUID()),
    note = path.join(book.dataDir, 'restore-staging', 'synthetic-note.txt');
  writeFileSync(unknown, '未知合成文件');
  writeFileSync(note, '合成普通文件');
  await book.store.dispose();
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'cancelled',
    stagingRetained: false,
  });
  expect(existsSync(file(ticket.replacementId))).toBe(false);
  expect(readFileSync(unknown, 'utf8')).toBe('未知合成文件');
  expect(readFileSync(note, 'utf8')).toBe('合成普通文件');
  expect(existsSync(book.store.pathOf(book.info.id))).toBe(true);
});

it.each(['文件替换', '目录替换'] as const)(
  'w_hf：取消遇到%s拒绝删除身份不明文件，修复原目录/文件后才清理',
  async (fault) => {
    book = await createTestBook();
    const ticket = await stage();
    const stageFile = file(ticket.replacementId),
      directory = path.dirname(stageFile);
    const original = fault === '文件替换' ? `${stageFile}.owned` : `${directory}-owned`;
    const foreignDir = path.join(book.dataDir, 'synthetic-foreign');
    if (fault === '文件替换') {
      renameSync(stageFile, original);
      writeFileSync(stageFile, '同名外来文件');
    } else {
      mkdirSync(foreignDir);
      writeFileSync(path.join(foreignDir, path.basename(stageFile)), '同名外来文件');
      renameSync(directory, original);
      symlinkSync(foreignDir, directory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    try {
      expect(() => cancel(ticket.replacementId)).toThrow(/暂存未能清理/);
      expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
        status: 'cancelled',
        cleanupPending: true,
        stagingRetained: true,
      });
      expect(readFileSync(stageFile, 'utf8')).toBe('同名外来文件');
    } finally {
      if (fault === '文件替换') {
        rmSync(stageFile);
        renameSync(original, stageFile);
      } else {
        rmSync(directory);
        renameSync(original, directory);
      }
      cancel(ticket.replacementId);
    }
    expect(existsSync(stageFile)).toBe(false);
  },
);

it('w_hf：过期定时清理遇身份异常不抛未捕获错误，保留待清理状态供显式处理', async () => {
  book = await createTestBook();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const ticket = await stage(undefined, Date.now() + 1000);
  const stageFile = file(ticket.replacementId),
    original = `${stageFile}.owned`;
  renameSync(stageFile, original);
  writeFileSync(stageFile, '同名外来文件');
  try {
    await vi.advanceTimersByTimeAsync(1001);
    expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
      status: 'expired',
      cleanupPending: true,
      stagingRetained: true,
    });
    expect(readFileSync(stageFile, 'utf8')).toBe('同名外来文件');
  } finally {
    rmSync(stageFile);
    renameSync(original, stageFile);
  }
  book.store.cleanupExpiredReplacements();
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'expired',
    cleanupPending: false,
    stagingRetained: false,
  });
});

it('w_hf：数据恢复已验证后只有暂存清理失败时状态仍为done，不错误回滚已成功恢复的账', async () => {
  book = await createTestBook();
  const bytes = raw().serialize();
  const restoredName = raw().prepare('SELECT org_name FROM book_info').pluck().get();
  raw().prepare("UPDATE book_info SET org_name='当前应保护账' WHERE id=1").run();
  const ticket = await stage(bytes);
  const stageFile = file(ticket.replacementId),
    original = `${stageFile}.owned`;
  try {
    await expect(
      book.store.maintain(book.info.id, {
        kind: 'replace',
        replacementId: ticket.replacementId,
        validate: async () => {
          renameSync(stageFile, original);
          writeFileSync(stageFile, '同名外来文件');
        },
      }),
    ).rejects.toThrow(/暂存未能清理/);
    expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
      status: 'done',
      cleanupPending: true,
      stagingRetained: true,
      relogin: true,
    });
    expect(raw().prepare('SELECT org_name FROM book_info').pluck().get()).toBe(restoredName);
    expect(protectionFiles()).toHaveLength(1);
  } finally {
    rmSync(stageFile);
    renameSync(original, stageFile);
    cancel(ticket.replacementId);
  }
  expect(book.store.replacementStatus(ticket.replacementId)).toMatchObject({
    status: 'done',
    cleanupPending: false,
    stagingRetained: false,
  });
});
