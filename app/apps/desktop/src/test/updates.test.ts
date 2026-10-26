import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DesktopUpdates,
  UPDATE_API,
  UPDATE_SOURCE,
  assetUrl,
  compareVersions,
  assertInstallerVersion,
  downloadUpdate,
  findUpdate,
  githubResponse,
  verifyInstaller,
  type Update,
} from '../updates';
import { prepareUpdateInstall } from '../update-backup';

const directories: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-update-'));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const bytes = Buffer.from('MZ synthetic installer, never executed');
function fixture(version = '0.3.0') {
  const name = `caiwu-desktop-${version}-x64-setup.exe`;
  const manifestName = `caiwu-desktop-${version}-x64-update.json`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const update: Update = {
    version,
    name,
    sha256,
    size: bytes.length,
    page: `${UPDATE_SOURCE}/releases/tag/v${version}`,
    url: assetUrl(version, name),
  };
  const manifest = { schema: 1, version, file: name, sha256, size: bytes.length };
  const release = {
    tag_name: `v${version}`,
    html_url: update.page,
    draft: false,
    prerelease: false,
    assets: [
      { name, size: bytes.length, digest: `sha256:${sha256}`, browser_download_url: update.url },
      { name: manifestName, browser_download_url: assetUrl(version, manifestName) },
    ],
  };
  const request = vi.fn<typeof fetch>(async (url) => {
    if (url === UPDATE_API) return Response.json(release);
    if (String(url).endsWith('-update.json')) return Response.json(manifest);
    if (url === update.url) return new Response(bytes);
    throw new Error('unexpected request');
  });
  return { update, manifest, release, request };
}

it('版本按数字比较，拒绝四段历史号、预发行及不规范标签', () => {
  expect(compareVersions('0.10.0', '0.2.0')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  for (const v of ['0.1.0.4', '01.2.3', '1.2.3-beta', '../1.2.3', '1.2.9999999'])
    expect(() => compareVersions(v, '0.2.0')).toThrow();
  expect(() => assertInstallerVersion('0.3.0.0', '0.3.0')).not.toThrow();
  expect(() => assertInstallerVersion('0.2.0', '0.3.0')).toThrow('内嵌版本');
});

it('只接受同一正式 Release 的固定安装包、清单及 GitHub 摘要', async () => {
  const f = fixture();
  expect(await findUpdate('0.2.0', '0.2.0', f.request)).toEqual(f.update);
  f.manifest.sha256 = '0'.repeat(64);
  await expect(findUpdate('0.2.0', '0.2.0', f.request)).rejects.toThrow('不一致');
  f.release.assets[0]!.browser_download_url = 'https://example.com/setup.exe';
  await expect(findUpdate('0.2.0', '0.2.0', f.request)).rejects.toThrow('来源');
});

it.each(['draft', 'prerelease'] as const)('拒绝 %s 发行版', async (field) => {
  const f = fixture();
  f.release[field] = true;
  await expect(findUpdate('0.2.0', '0.2.0', f.request)).rejects.toThrow('正式稳定');
});

it('无正式发行、限流、超时都不虚报当前最新；缺少 GitHub 摘要时拒绝', async () => {
  for (const status of [404, 429, 500]) {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    await expect(findUpdate('0.2.0', '0.2.0', request)).rejects.toThrow();
  }
  const timeout = vi.fn<typeof fetch>(async () => {
    throw new DOMException('timeout', 'TimeoutError');
  });
  await expect(findUpdate('0.2.0', '0.2.0', timeout)).rejects.toThrow();
  const f = fixture();
  f.release.assets[0]!.digest = '';
  await expect(findUpdate('0.2.0', '0.2.0', f.request)).rejects.toThrow('SHA-256');
});

it('重定向只允许 HTTPS GitHub 资源，拒绝跨域、降级和 API 跳转且不发下一跳', async () => {
  const f = fixture();
  for (const location of [
    'https://example.com/file',
    'http://release-assets.githubusercontent.com/file',
    'https://release-assets.githubusercontent.com:444/file',
  ]) {
    const request = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    await expect(
      githubResponse(f.update.url, new AbortController().signal, request),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  }
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/file' },
      }),
  );
  await expect(githubResponse(UPDATE_API, new AbortController().signal, request)).rejects.toThrow(
    '无效跳转',
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it('下载真实落盘，拒绝截断、超长、非 PE、摘要错和安装前被替换，失败不留可执行文件', async () => {
  const f = fixture();
  const directory = await temp();
  const target = await downloadUpdate(f.update, directory, f.request);
  expect(await readFile(target)).toEqual(bytes);
  if (process.platform === 'win32')
    expect(await readFile(`${target}:Zone.Identifier`, 'utf8')).toContain('ZoneId=3');
  await verifyInstaller(target, f.update);
  await writeFile(target, Buffer.alloc(bytes.length));
  await expect(verifyInstaller(target, f.update)).rejects.toThrow('完整性');
  for (const body of [
    bytes.subarray(0, 3),
    Buffer.concat([bytes, bytes]),
    Buffer.alloc(bytes.length),
  ]) {
    const dir = await temp();
    const request = vi.fn<typeof fetch>(async () => new Response(body));
    await expect(downloadUpdate(f.update, dir, request)).rejects.toThrow('未完成或校验失败');
    expect(await readdir(dir)).toEqual([]);
  }
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(bytes.subarray(0, 3), {
        headers: { 'content-length': String(bytes.length) },
      }),
  );
  const dir = await temp();
  await expect(downloadUpdate(f.update, dir, request)).rejects.toThrow();
  expect(await readdir(dir)).toEqual([]);
});

it('版本高水位跨会话保留，拒绝源回退；更新失败后必须重新检查，不能启动旧缓存', async () => {
  const f = fixture();
  const dir = await temp();
  const first = new DesktopUpdates('0.2.0', dir, f.request);
  expect((await first.check()).state).toBe('available');
  expect((await first.download()).state).toBe('downloaded');
  expect((await first.installer()).update).toEqual(f.update);
  const old = fixture('0.2.1');
  const second = new DesktopUpdates('0.2.0', dir, old.request);
  expect((await second.check()).message).toContain('回退');
  await expect(second.installer()).rejects.toThrow('尚无');
  await writeFile(path.join(dir, 'version.json'), '{bad');
  expect((await first.check()).message).toContain('记录损坏');
  await expect(first.installer()).rejects.toThrow('尚无');
});

it('关闭未确认、备份失败、安装前篡改均阻止启动；正常流程严格按关闭→备份→复验→启动', async () => {
  const events: string[] = [];
  const ops = {
    stop: vi.fn(async () => {
      events.push('stop');
      return true;
    }),
    backup: vi.fn(async () => {
      events.push('backup');
    }),
    verify: vi.fn(async () => {
      events.push('verify');
    }),
    launch: vi.fn(async () => {
      events.push('launch');
    }),
  };
  expect(await prepareUpdateInstall(ops)).toBe(true);
  expect(events).toEqual(['stop', 'backup', 'verify', 'launch']);
  ops.launch.mockClear();
  ops.backup.mockClear();
  ops.stop.mockResolvedValueOnce(false);
  expect(await prepareUpdateInstall(ops)).toBe(false);
  expect(ops.backup).not.toHaveBeenCalled();
  let requested = true;
  ops.stop.mockImplementationOnce(async () => {
    // 对应服务第一次等待超时后撤销安装，用户继续等同一服务，最终正常退出。
    requested = false;
    return true;
  });
  expect(await prepareUpdateInstall({ ...ops, requested: () => requested })).toBe(false);
  expect(ops.backup).not.toHaveBeenCalled();
  ops.backup.mockRejectedValueOnce(new Error('磁盘空间不足'));
  await expect(prepareUpdateInstall(ops)).rejects.toThrow('磁盘空间不足');
  ops.verify.mockRejectedValueOnce(new Error('摘要不符'));
  await expect(prepareUpdateInstall(ops)).rejects.toThrow('摘要不符');
  expect(ops.launch).not.toHaveBeenCalled();
});
