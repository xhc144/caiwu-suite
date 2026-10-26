import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { mockAvailableUpdate } from './update-checks';

type Event = { at: string; event: string; [key: string]: unknown };
type OsState = {
  installers: { pid: number; interactive: boolean; created: string }[];
  security: string[];
};

test('健康合成账套：应用真实备份/排空退出 → Windows Shell 实际启动本次安装器；安全提示不代点', async () => {
  const root = process.env.CAIWU_DESKTOP_UPDATE_QA_FIXTURE;
  const oldInstaller = process.env.CAIWU_DESKTOP_OLD_INSTALLER;
  const installer = process.env.CAIWU_DESKTOP_NEW_INSTALLER;
  const executable = process.env.CAIWU_DESKTOP_HANDOFF_EXECUTABLE;
  const output = process.env.CAIWU_DESKTOP_HANDOFF_LOG;
  const version = process.env.CAIWU_DESKTOP_EXPECTED_VERSION;
  if (
    process.platform !== 'win32' ||
    !root ||
    !oldInstaller ||
    !installer ||
    !executable ||
    !output ||
    !version
  )
    throw new Error('成功交接 QA 必须在 Windows 使用独立合成 fixture 和本次生成的安装器');
  const fixture = JSON.parse(readFileSync(path.join(root, 'fixture.json'), 'utf8')) as {
    bookId: string;
    dataDir: string;
    configDir: string;
  };
  const record = (event: string, extra: Record<string, unknown> = {}) => {
    const entry = { at: new Date().toISOString(), event, ...extra };
    appendFileSync(output, `${JSON.stringify(entry)}\n`);
    console.log(JSON.stringify(entry));
  };
  record('handoff-qa-start', {
    targetVersion: version,
    sameCodeSetupVersion: '0.0.9',
    liveRelease: false,
  });
  // 只用同一次构建的测试旧包准备隔离安装。成功交接时绝不 /S，不调用测试进程 spawn 安装器。
  const setup = await new Promise<number>((resolve, reject) => {
    const child = spawn(oldInstaller, ['/S', '/currentuser', `/D=${path.dirname(executable)}`], {
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? -1));
  });
  expect(setup).toBe(0);
  expect(existsSync(executable)).toBe(true);
  const previousBackup = path.join(fixture.dataDir, 'backups', '合成账套备份.caiwu');
  const previousHash = createHash('sha256').update(readFileSync(previousBackup)).digest('hex');
  let desktop: ElectronApplication | undefined;
  let requested = false;
  try {
    desktop = await _electron.launch({
      executablePath: executable,
      args: [],
      env: {
        ...process.env,
        NODE_PATH: '',
        CAIWU_DATA_DIR: '',
        CAIWU_DESKTOP_USER_DATA_DIR: fixture.configDir,
        CAIWU_DEV: '0',
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.getByText('测试账套', { exact: true })).toBeVisible();
    const { sha256 } = await mockAvailableUpdate(desktop, page, installer, version);
    expect((await page.evaluate(() => window.caiwuDesktopHost!.updates.check())).state).toBe(
      'available',
    );
    expect((await page.evaluate(() => window.caiwuDesktopHost!.updates.download())).state).toBe(
      'downloaded',
    );
    const cached = readdirSync(path.join(fixture.configDir, 'updates')).filter((name) =>
      name.endsWith('-setup.exe'),
    );
    expect(cached).toHaveLength(1);
    const downloaded = path.join(fixture.configDir, 'updates', cached[0]!);
    expect(createHash('sha256').update(readFileSync(downloaded)).digest('hex')).toBe(sha256);
    expect(readFileSync(`${downloaded}:Zone.Identifier`, 'utf8')).toContain('ZoneId=3');
    record('real-installer-downloaded', { sha256, internetZone: 3 });

    await desktop.evaluate(
      ({ shell, dialog }, input) => {
        const fs = process.getBuiltinModule('fs');
        const paths = process.getBuiltinModule('path');
        const crypto = process.getBuiltinModule('crypto');
        const load = process
          .getBuiltinModule('module')
          .createRequire(paths.join(process.resourcesPath, 'app.asar', 'package.json'));
        const Database = load('better-sqlite3');
        const record = (event: string, extra: Record<string, unknown> = {}) =>
          fs.appendFileSync(
            input.output,
            `${JSON.stringify({ at: new Date().toISOString(), event, ...extra })}\n`,
          );
        // 仅响应应用自身的安装确认；不接触 Windows/SmartScreen/UAC 或 NSIS 的窗口。
        dialog.showMessageBox = async (
          first: Electron.BaseWindow | Electron.MessageBoxOptions,
          second?: Electron.MessageBoxOptions,
        ) => {
          const options = second ?? (first as Electron.MessageBoxOptions);
          if (options.title !== '保存退出并安装更新') throw new Error('出现未预期的应用对话框');
          return { response: 1, checkboxChecked: false };
        };
        const originalOpenPath = shell.openPath.bind(shell);
        shell.openPath = async (file) => {
          if (file !== input.downloaded) throw new Error('交接目标不是本次已校验的下载文件');
          const log = fs
            .readFileSync(paths.join(input.configDir, 'logs', 'desktop.log'), 'utf8')
            .trim()
            .split('\n')
            .map((line: string) => JSON.parse(line) as { at: string; event: string });
          const completed = log.findLast(
            (entry: { event: string }) => entry.event === 'service-stop-completed',
          );
          if (!completed || fs.existsSync(paths.join(input.dataDir, '.caiwu-runtime.lock')))
            throw new Error('没有服务排空退出/目录锁释放证据');
          record('app-service-stop-completed', { serviceAt: completed.at });
          const backupRoot = paths.join(input.dataDir, 'backups');
          const directories = fs
            .readdirSync(backupRoot)
            .filter((name: string) => name.startsWith('更新前-'));
          if (directories.length !== 1) throw new Error('健康账套没有唯一的成功更新前备份');
          const directory = paths.join(backupRoot, directories[0]!);
          const manifest = JSON.parse(
            fs.readFileSync(paths.join(directory, '备份清单.json'), 'utf8'),
          ) as { files: { file: string; sha256: string }[] };
          if (manifest.files.length !== 1) throw new Error('备份清单账套数量不符');
          const entry = manifest.files[0]!;
          const snapshot = paths.join(directory, entry.file);
          if (
            crypto.createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex') !==
            entry.sha256
          )
            throw new Error('独立复验备份摘要失败');
          const raw = new Database(snapshot, { readonly: true, fileMustExist: true });
          try {
            if (
              raw.pragma('integrity_check', { simple: true }) !== 'ok' ||
              raw.pragma('foreign_key_check').length
            )
              throw new Error('独立 SQLite 备份完整性/外键检查失败');
            const vouchers = raw
              .prepare('SELECT debit_total,credit_total,source_module,source_id FROM voucher')
              .all();
            if (
              JSON.stringify(vouchers) !==
              JSON.stringify([
                {
                  debit_total: 12345,
                  credit_total: 12345,
                  source_module: 'cashier',
                  source_id: 'synthetic-update-receipt',
                },
              ])
            )
              throw new Error('健康备份中的整数金额或来源单据不符');
            const permissions = raw
              .prepare(
                "SELECT p.permission,u.is_admin FROM user_permission p JOIN app_user u ON p.user_id=u.id WHERE u.code='update-viewer'",
              )
              .all();
            if (
              JSON.stringify(permissions) !==
              JSON.stringify([{ permission: 'example.view', is_admin: 0 }])
            )
              throw new Error('健康备份中的普通操作员权限不符');
          } finally {
            raw.close();
          }
          record('app-healthy-backup-independently-verified', {
            books: 1,
            cents: 12345,
            sourcePreserved: true,
            permissionsPreserved: true,
          });
          record('real-shell-openPath-requested', { internetZone: 3 });
          // 观察包装器调用真正的 Electron Shell 方法；不替换其结果，不移除来源标记。
          const result = await originalOpenPath(file);
          record('real-shell-openPath-returned', { accepted: result === '' });
          return result;
        };
      },
      { downloaded, output, configDir: fixture.configDir, dataDir: fixture.dataDir },
    );
    const handle = desktop.process();
    requested = true;
    record('app-update-install-requested');
    void page.evaluate(() => window.caiwuDesktopHost!.updates.install()).catch(() => {});
    const probe = (): OsState =>
      JSON.parse(
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$p=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CAIWU_QA_CACHED_INSTALLER } | ForEach-Object { @{pid=$_.ProcessId;interactive=($_.CommandLine -notmatch '(?i)(?:^|\\s)/S(?:\\s|$)');created=$_.CreationDate.ToString('o')} });$s=@(Get-Process smartscreen,consent -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -or $_.ProcessName -eq 'consent' } | ForEach-Object {$_.ProcessName});@{installers=$p;security=$s}|ConvertTo-Json -Compress -Depth 4",
          ],
          {
            env: { ...process.env, CAIWU_QA_CACHED_INSTALLER: downloaded },
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
          },
        ),
      ) as OsState;
    let state: OsState = { installers: [], security: [] };
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      state = probe();
      if (state.installers.length || state.security.length) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!state.installers.length) {
      const events = readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Event);
      if (!events.some((entry) => entry.event === 'real-shell-openPath-requested')) {
        record('app-did-not-reach-real-shell', { appExitCode: handle.exitCode });
        throw new Error('应用未进入真实 Shell 调用，需检查备份/退出证据；不能认定是系统安全提示');
      }
      if (
        events.some((entry) => entry.event === 'real-shell-openPath-returned' && !entry.accepted)
      ) {
        record('windows-shell-rejected-launch', {
          security: state.security,
          appExitCode: handle.exitCode,
        });
        throw new Error(
          'Windows Shell 返回启动失败，安装器未被观测到；需核查系统原因，不改道或绕过',
        );
      }
      record('paused-for-human-windows-interaction', {
        security: state.security,
        appExitCode: handle.exitCode,
      });
      throw new Error(
        '真实备份后已请求 Windows Shell；安全/系统交互需要人工确认，成功启动证据暂停。没有代点、取消或绕过系统提示。',
      );
    }
    expect(state.installers.every((process) => process.interactive)).toBe(true);
    await expect.poll(() => handle.exitCode, { timeout: 15_000 }).toBe(0);
    const events = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Event);
    expect(events.map((entry) => entry.event)).toContain(
      'app-healthy-backup-independently-verified',
    );
    expect(events.find((entry) => entry.event === 'real-shell-openPath-returned')?.accepted).toBe(
      true,
    );
    expect(createHash('sha256').update(readFileSync(previousBackup)).digest('hex')).toBe(
      previousHash,
    );
    record('app-exited-zero-and-real-installer-observed', {
      appExitCode: handle.exitCode,
      installers: state.installers,
      interactive: true,
    });
    record('handoff-qa-complete', {
      installerUiNotDriven: true,
      installationCompletionNotClaimed: true,
    });
    desktop = undefined;
    // 真实安装器停留在其正常交互界面；不代点安全提示或安装向导。由临时 runner 最终清理进程。
  } finally {
    if (desktop && !requested) await desktop.close().catch(() => {});
  }
});
