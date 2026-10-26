import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const UPDATE_SOURCE = 'https://github.com/xhc144/caiwu-suite';
export const UPDATE_API = 'https://api.github.com/repos/xhc144/caiwu-suite/releases/latest';
const MAX_INSTALLER = 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
export type Update = {
  version: string;
  page: string;
  url: string;
  name: string;
  size: number;
  sha256: string;
};
export type UpdateStatus = {
  current: string;
  source: string;
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  update: Update | null;
  message: string;
};

function versionParts(value: string): number[] {
  if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value))
    throw new Error('更新版本格式不受支持，请从项目正式发行页核实版本');
  return value.split('.').map(Number);
}
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
export function assertInstallerVersion(actual: string, expected: string): void {
  versionParts(expected);
  if (actual.trim() !== expected && actual.trim() !== `${expected}.0`)
    throw new Error('安装包内嵌版本与正式更新版本不一致，已停止安装');
}

export async function verifyWindowsInstallerVersion(file: string, expected: string): Promise<void> {
  // 静态脚本与路径分开；不执行安装器来查询版本，不处理或绕过 SmartScreen。
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::Write([Diagnostics.FileVersionInfo]::GetVersionInfo($env:CAIWU_UPDATE_FILE).ProductVersion)',
    ],
    {
      env: { ...process.env, CAIWU_UPDATE_FILE: file },
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 4096,
    },
  );
  assertInstallerVersion(stdout, expected);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('更新信息格式无效，请稍后重新检查');
  return value as Record<string, unknown>;
}
export function assetUrl(version: string, name: string): string {
  versionParts(version);
  return `${UPDATE_SOURCE}/releases/download/v${version}/${name}`;
}
function allowedUrl(raw: string, initial: string): boolean {
  const url = new URL(raw);
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.hash &&
    (raw === initial || url.hostname === 'release-assets.githubusercontent.com')
  );
}

/** 只在主进程请求；不接收页面提供的地址，不携带令牌，重定向逐跳检查。 */
export async function githubResponse(
  initial: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Response> {
  if (initial !== UPDATE_API && !initial.startsWith(`${UPDATE_SOURCE}/releases/download/`))
    throw new Error('更新来源不在本软件指定的项目发行渠道中');
  let url = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowedUrl(url, initial)) throw new Error('更新下载跳转到了不受信任的地址，已停止');
    const response = await request(url, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'application/json', 'User-Agent': 'caiwu-desktop-update' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || initial === UPDATE_API) throw new Error('更新来源返回了无效跳转');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) throw new Error('项目尚无可用的正式更新，请稍后重新检查');
      throw new Error(`更新服务暂不可用（HTTP ${response.status}），请稍后重新检查`);
    }
    return response;
  }
  throw new Error('更新下载跳转次数过多，已停止');
}

async function consume(
  response: Response,
  maximum: number,
  chunk: (b: Uint8Array) => Promise<void>,
) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    await response.body?.cancel();
    throw new Error('更新文件大小无效或超出限制，已停止下载');
  }
  if (!response.body) throw new Error('更新服务没有返回文件内容');
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('更新文件超过预期大小，已停止下载');
      await chunk(value);
    }
    if (length && size !== length) throw new Error('更新下载不完整，请重新下载');
    return size;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function json(response: Response, limit: number): Promise<unknown> {
  const buffers: Uint8Array[] = [];
  await consume(response, limit, async (b) => {
    buffers.push(b);
  });
  return JSON.parse(Buffer.concat(buffers).toString('utf8')) as unknown;
}

export async function findUpdate(
  current: string,
  floor: string,
  request: typeof fetch = fetch,
): Promise<Update | null> {
  const signal = AbortSignal.timeout(30_000);
  const release = object(await json(await githubResponse(UPDATE_API, signal, request), 256 * 1024));
  if (
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== 'string'
  )
    throw new Error('更新来源不是正式稳定发行版，已停止');
  const version = release.tag_name.replace(/^v/, '');
  versionParts(version);
  if (
    release.tag_name !== `v${version}` ||
    release.html_url !== `${UPDATE_SOURCE}/releases/tag/v${version}`
  )
    throw new Error('更新发行页与版本不一致，已停止');
  if (compareVersions(version, floor) < 0)
    throw new Error('更新源返回了更旧的版本，已阻止版本回退');
  if (compareVersions(version, current) <= 0) return null;
  const name = `caiwu-desktop-${version}-x64-setup.exe`;
  const manifestName = `caiwu-desktop-${version}-x64-update.json`;
  if (!Array.isArray(release.assets)) throw new Error('正式更新缺少下载文件');
  const assets = release.assets.map(object);
  const installer = assets.filter((a) => a.name === name);
  const manifests = assets.filter((a) => a.name === manifestName);
  if (installer.length !== 1 || manifests.length !== 1)
    throw new Error('正式更新缺少唯一的安装包或校验文件');
  const file = installer[0]!;
  const manifest = manifests[0]!;
  if (
    file.browser_download_url !== assetUrl(version, name) ||
    manifest.browser_download_url !== assetUrl(version, manifestName) ||
    !Number.isSafeInteger(file.size) ||
    Number(file.size) < 2 ||
    Number(file.size) > MAX_INSTALLER ||
    typeof file.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(file.digest)
  )
    throw new Error('更新安装包的来源、大小或 GitHub SHA-256 不完整，已停止');
  const data = object(
    await json(await githubResponse(assetUrl(version, manifestName), signal, request), 8192),
  );
  if (
    data.schema !== 1 ||
    data.version !== version ||
    data.file !== name ||
    data.size !== file.size ||
    data.sha256 !== file.digest.slice(7)
  )
    throw new Error('更新清单与 GitHub 安装包校验信息不一致，已停止');
  return {
    version,
    name,
    size: Number(file.size),
    sha256: String(data.sha256),
    page: String(release.html_url),
    url: assetUrl(version, name),
  };
}

export async function verifyInstaller(file: string, update: Update): Promise<void> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== update.size)
    throw new Error('更新安装包大小或文件类型已改变，请重新下载');
  const hash = createHash('sha256');
  let header = Buffer.alloc(0);
  for await (const value of createReadStream(file)) {
    const b = value as Buffer;
    if (header.length < 2) header = Buffer.concat([header, b]).subarray(0, 2);
    hash.update(b);
  }
  if (
    !SHA256.test(update.sha256) ||
    hash.digest('hex') !== update.sha256 ||
    header.toString() !== 'MZ'
  )
    throw new Error('更新安装包完整性校验失败，请重新下载；当前程序和账套未更改');
}

/** 下载目录在用户配置目录内；失败删除本次临时文件，不复用旧安装包。 */
export async function downloadUpdate(
  update: Update,
  directory: string,
  request: typeof fetch = fetch,
) {
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('更新缓存目录不支持目录链接');
  const target = path.join(directory, `${randomUUID()}-${update.name}`);
  const temporary = `${target}.part`;
  try {
    const response = await githubResponse(update.url, AbortSignal.timeout(300_000), request);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await consume(response, update.size, async (chunk) => {
        await handle.writeFile(chunk);
      });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verifyInstaller(temporary, update);
    await rename(temporary, target);
    if (process.platform === 'win32') {
      // 保留 Internet 来源标记，交给 Windows Shell 正常显示安全检查；写入失败则拒绝安装。
      await writeFile(
        `${target}:Zone.Identifier`,
        `[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=${update.page}\r\nHostUrl=${update.url}\r\n`,
        { flag: 'wx' },
      );
    }
    return target;
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(target, { force: true });
    throw new Error('更新下载未完成或校验失败，请重新检查更新后再下载；当前程序和账套未更改', {
      cause: error,
    });
  }
}

export class DesktopUpdates {
  #busy = false;
  #file: string | null = null;
  #status: UpdateStatus;
  constructor(
    readonly current: string,
    readonly directory: string,
    private readonly request: typeof fetch = fetch,
  ) {
    versionParts(current);
    this.#status = {
      current,
      source: UPDATE_SOURCE,
      state: 'idle',
      update: null,
      message: '尚未检查更新',
    };
  }
  status(): UpdateStatus {
    return structuredClone(this.#status);
  }
  async #floor(): Promise<string> {
    try {
      const data = object(
        JSON.parse(await readFile(path.join(this.directory, 'version.json'), 'utf8')),
      );
      if (data.schema !== 1 || typeof data.highest !== 'string') throw new Error('更新记录无效');
      return compareVersions(data.highest, this.current) > 0 ? data.highest : this.current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.current;
      throw new Error('更新版本记录损坏，已停止自动更新；请保留配置并联系维护人员', {
        cause: error,
      });
    }
  }
  async check(): Promise<UpdateStatus> {
    return this.#run('checking', async () => {
      this.#file = null;
      this.#status.update = null;
      const update = await findUpdate(this.current, await this.#floor(), this.request);
      if (update) {
        await mkdir(this.directory, { recursive: true });
        const temp = path.join(this.directory, `${randomUUID()}.json`);
        try {
          await writeFile(temp, JSON.stringify({ schema: 1, highest: update.version }), {
            flag: 'wx',
            mode: 0o600,
          });
          await rename(temp, path.join(this.directory, 'version.json'));
        } finally {
          await rm(temp, { force: true });
        }
      }
      this.#status = {
        ...this.#status,
        state: update ? 'available' : 'idle',
        update,
        message: update ? `发现新版本 ${update.version}` : '当前已是最新的正式版本',
      };
    });
  }
  async download(): Promise<UpdateStatus> {
    const update = this.#status.update;
    if (!update || this.#status.state !== 'available') throw new Error('请先重新检查可用更新');
    return this.#run('downloading', async () => {
      this.#file = null;
      this.#file = await downloadUpdate(update, this.directory, this.request);
      this.#status.state = 'downloaded';
      this.#status.message = '安装包已下载并通过 SHA-256 校验';
    });
  }
  async installer(): Promise<{ file: string; update: Update }> {
    if (this.#busy || this.#status.state !== 'downloaded' || !this.#file || !this.#status.update)
      throw new Error('尚无已校验的更新安装包，请重新检查并下载');
    const update = this.#status.update;
    if (
      compareVersions(update.version, await this.#floor()) < 0 ||
      compareVersions(update.version, this.current) <= 0
    )
      throw new Error('已阻止安装旧版本，请重新检查更新');
    try {
      await verifyInstaller(this.#file, update);
    } catch (error) {
      this.#file = null;
      this.#status.state = 'error';
      throw error;
    }
    return { file: this.#file, update };
  }
  async #run(state: UpdateStatus['state'], fn: () => Promise<void>) {
    if (this.#busy) throw new Error('更新操作正在进行，请稍候');
    this.#busy = true;
    this.#status.state = state;
    try {
      await fn();
    } catch (error) {
      this.#status.state = 'error';
      this.#status.message = error instanceof Error ? error.message : '更新未完成，请稍后重新检查';
    } finally {
      this.#busy = false;
    }
    return this.status();
  }
}
