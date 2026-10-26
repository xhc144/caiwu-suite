import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../errors';

type OwnerInfo = { protocol: number; pid: number; token: string; kind: 'server' | 'runtime' };
type DirectoryOwner = {
  lock: string;
  info: OwnerInfo;
  inode: { ino: number; dev: number };
  refs: number;
  member?: string;
};
const owners = new Map<string, DirectoryOwner>();
const occupied = () =>
  new BusinessError({
    code: 'DATA_DIR_IN_USE',
    message: '数据目录已被占用或留有未确认的运行锁',
    hint: '请先正常关闭占用它的服务；异常退出后的锁须由管理员核实，程序不会自动清除',
  });
const participating = () =>
  new BusinessError({
    code: 'DATA_DIR_HAS_PARTICIPANTS',
    message: '数据目录有其他维护或辅助进程占用，暂不能维护或退出',
    hint: '请先正常结束辅助进程，再重试；程序不会清除未知参与者记录',
  });

/** 短同步临界区，无 sleep/自动抢锁。崩溃残留使后续操作拒绝，须人工核实。 */
function admission<T>(directory: string, fn: () => T): T {
  const guard = path.join(directory, '.caiwu-admission.lock');
  try {
    mkdirSync(guard, { mode: 0o700 });
  } catch (_cause) {
    throw occupied();
  }
  const inode = lstatSync(guard);
  const release = () => {
    const current = lstatSync(guard);
    if (current.ino !== inode.ino || current.dev !== inode.dev || current.isSymbolicLink())
      throw occupied();
    rmdirSync(guard);
  };
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * 单 server 独占；同进程 runtime 共用门。跨进程辅助 runtime 登记完整生命周期，
 * 其存活期间维护直接拒绝，维护期间新辅助进程不能加入。未知 SQLite 客户端不在协议内。
 */
export class DataDirectoryLease {
  readonly directory: string;
  readonly #owner: DirectoryOwner;
  readonly #server: boolean;
  #released = false;

  constructor(dataDir: string, opts: { server?: boolean } = {}) {
    mkdirSync(dataDir, { recursive: true });
    this.directory = realpathSync(dataDir);
    this.#server = opts.server ?? false;
    this.#owner = admission(this.directory, () => {
      const existing = owners.get(this.directory);
      if (existing) {
        verify(existing);
        if (this.#server) throw occupied();
        existing.refs++;
        return existing;
      }
      const lock = path.join(this.directory, '.caiwu-runtime.lock');
      if (existsSync(lock)) {
        if (this.#server || lstatSync(lock).isSymbolicLink()) throw occupied();
        const info = readOwner(lock);
        // 只允许加入仍存活的已知 server，绝不接管或清除旧锁。
        if (info.kind !== 'server' || existsSync(path.join(lock, 'maintenance.json')))
          throw occupied();
        try {
          process.kill(info.pid, 0);
        } catch (_cause) {
          throw occupied();
        }
        const member = path.join(lock, `member-${randomUUID()}.json`);
        writeFileSync(member, JSON.stringify({ pid: process.pid, protocol: 1 }), {
          flag: 'wx',
          mode: 0o600,
        });
        const owner = { lock, info, inode: lstatSync(lock), refs: 1, member };
        owners.set(this.directory, owner);
        return owner;
      }
      mkdirSync(lock, { mode: 0o700 });
      const info: OwnerInfo = {
        protocol: 1,
        pid: process.pid,
        token: randomUUID(),
        kind: this.#server ? 'server' : 'runtime',
      };
      // 写入失败时保留锁，绝不递归删除不确定的内容。
      writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(info), {
        flag: 'wx',
        mode: 0o600,
      });
      const owner = { lock, info, inode: lstatSync(lock), refs: 1 };
      owners.set(this.directory, owner);
      return owner;
    });
  }

  assertOwned(): void {
    if (this.#released) throw occupied();
    verify(this.#owner);
  }

  get isAuxiliary(): boolean {
    return !!this.#owner.member;
  }

  /** 全目录维护串行；辅助进程在途期间不宣称能远程排空其事务。 */
  beginMaintenance(): () => void {
    this.assertOwned();
    const owner = this.#owner;
    const marker = path.join(owner.lock, 'maintenance.json');
    const token = randomUUID();
    admission(this.directory, () => {
      verify(owner);
      if (owner.member || readdirSync(owner.lock).some((name) => name !== 'owner.json'))
        throw participating();
      writeFileSync(marker, JSON.stringify({ token }), { flag: 'wx', mode: 0o600 });
    });
    return () => {
      // 所有工作结束后才原子移除自己的门；加入者在移除前拒绝、移除后可登记。
      verify(owner);
      if (JSON.parse(readFileSync(marker, 'utf8')).token !== token) throw occupied();
      unlinkSync(marker);
    };
  }

  release(): void {
    if (this.#released) return;
    admission(this.directory, () => {
      this.assertOwned();
      const owner = this.#owner;
      if (owner.refs === 1) {
        if (owner.member) unlinkSync(owner.member);
        else {
          if (readdirSync(owner.lock).join() !== 'owner.json') throw participating();
          unlinkSync(path.join(owner.lock, 'owner.json'));
          rmdirSync(owner.lock);
        }
        owners.delete(this.directory);
      }
      owner.refs--;
      this.#released = true;
    });
  }
}

function readOwner(lock: string): OwnerInfo {
  const info = JSON.parse(readFileSync(path.join(lock, 'owner.json'), 'utf8')) as OwnerInfo;
  if (
    info.protocol !== 1 ||
    !Number.isInteger(info.pid) ||
    info.pid <= 0 ||
    typeof info.token !== 'string' ||
    !['server', 'runtime'].includes(info.kind)
  )
    throw occupied();
  return info;
}
function verify(owner: DirectoryOwner): void {
  const stat = lstatSync(owner.lock);
  if (
    stat.isSymbolicLink() ||
    stat.ino !== owner.inode.ino ||
    stat.dev !== owner.inode.dev ||
    readOwner(owner.lock).token !== owner.info.token ||
    (owner.member && !existsSync(owner.member))
  )
    throw occupied();
}
