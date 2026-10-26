import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test, expect, type Locator } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { loginWithNewBook, callApi } from '@caiwu/testkit/e2e';
import type { Batch } from '../shared';
import payroll from '../server';

async function select(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}

test('工资：独立账套建结构与三人 → 手算税额 → 工资条Excel → 来源凭证 → 审核后来源锁定', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(90000);
  // 此测试独占目录及随机端口，只打开自己创建的账套；生产 router 无任何造数接口。
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'payroll-e2e-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CAIWU_PORT: '0',
      CAIWU_TOKEN: 'e2e-token',
      CAIWU_DEV: '1',
      CAIWU_DATA_DIR: dataDir,
      CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const runtime = createRuntime({ dataDir, modules: [payroll], devMode: true });
  let output = '';
  child.stderr.on('data', (data) => {
    output += String(data);
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`工资测试服务未就绪：${output}`)), 20000);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`工资测试服务退出 ${code}：${output}`));
      });
      child.stdout.on('data', (data) => {
        output += String(data);
        const ready = /CAIWU_READY (\{[^\n]+\})/.exec(output);
        if (ready) {
          clearTimeout(timeout);
          resolve((JSON.parse(ready[1]!) as { port: number }).port);
        }
      });
    });
    const baseURL = `http://127.0.0.1:${port}`;
    const request = await playwright.request.newContext({ baseURL });
    const context = await browser.newContext({ baseURL });
    context.setDefaultTimeout(10000);
    const page = await context.newPage();
    try {
      const { bookId, token } = await loginWithNewBook(page, request, { product: 'minfei' });
      const book = runtime.bookStore.open(bookId);
      const user = (await loadServiceUser(book.db, 1))!;
      const svc = createCoreServices({
        db: book.db,
        user,
        moduleId: null,
        now: runtime.now,
        modules: runtime.modules.lookup,
      });
      const scheme = (await svc.book.info()).codeScheme;
      await svc.accounts.create(
        { code: '2241', name: '合成个人扣款', categoryId: 'liability' },
        scheme,
      );
      await svc.accounts.create({ code: '222102', name: '合成个人所得税' }, scheme);
      await svc.dimensions.create({ type: 'department', code: 'PAY', name: '合成工资部' });
      await page.goto('/m/payroll/structure');
      await page.getByRole('button', { name: '新增工资类别' }).click();
      let drawer = page.getByRole('dialog', { name: '工资栏目与公式定义' });
      await drawer.getByLabel('工资类别名称').fill('合成月薪');
      // 添加真实基础公式，津贴=基本工资10%，计入应发。
      await drawer.getByRole('button', { name: '增加栏目' }).click();
      await drawer.getByLabel('稳定变量').last().fill('allowance');
      await drawer.getByLabel('栏目名称').last().fill('津贴');
      await drawer.getByLabel('类型').last().click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('计算项', { exact: true })
        .click();
      await drawer.getByRole('button', { name: '增加公式' }).click();
      await drawer.getByLabel('公式名称').fill('基本工资津贴');
      await drawer.getByLabel('目标变量').fill('allowance');
      await drawer.getByLabel('来源表达式').fill('base * 0.1');
      await drawer.getByRole('button', { name: '保存结构' }).click();
      await expect(drawer).not.toBeVisible();
      await page.goto('/m/payroll/employees');
      for (let i = 1; i <= 3; i++) {
        await page.getByRole('button', { name: '新增员工' }).click();
        drawer = page.getByRole('dialog', { name: '新增员工' });
        await drawer.getByLabel('人员编号').fill(`E00${i}`);
        await drawer.getByLabel('姓名', { exact: true }).fill(`合成人员${i}`);
        await select(drawer.getByLabel('部门', { exact: true }), 'PAY');
        await drawer.getByRole('button', { name: '保存员工' }).click();
        await expect(drawer).not.toBeVisible();
      }
      await page.goto('/m/payroll/tax');
      await page.getByRole('button', { name: '确认本账套计税参数' }).click();
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await expect(page.getByText('本账套已确认参数', { exact: true })).toBeVisible();
      await page.goto('/m/payroll');
      await page.getByRole('button', { name: '新增工资批次' }).click();
      drawer = page.getByRole('dialog', { name: '新增工资批次' });
      for (let i = 1; i <= 3; i++)
        await select(drawer.getByRole('combobox', { name: '添加人员' }), `E00${i}`);
      const employees = await callApi<{ id: number }[]>(request, 'm.payroll.employees', undefined, {
        token,
        method: 'GET',
      });
      for (let i = 0; i < 3; i++) {
        const id = employees[i]!.id;
        await drawer
          .getByLabel(`${id}-base`, { exact: true })
          .fill(String([10000, 30000, 50000][i]));
        await drawer.locator('details').nth(i).locator('summary').click();
        await drawer
          .getByLabel(`${id}-additional`, { exact: true })
          .fill(String([1000, 2000, 0][i]));
      }
      for (const checkbox of await drawer.getByRole('checkbox').all()) await checkbox.check();
      await drawer.getByRole('button', { name: '保存工资' }).click();
      await expect(drawer).not.toBeVisible();
      await page.getByRole('button', { name: '计算工资', exact: true }).click();
      // 应发11000/33000/55000；扣费用5000与附加1000/2000/0，税150/780/2480。
      const salary = page.locator('.cw-data-table').last();
      for (const [i, tax, net] of [
        [1, '150.00', '10,850.00'],
        [2, '780.00', '32,220.00'],
        [3, '2,480.00', '52,520.00'],
      ] as const) {
        const r = salary.getByRole('row').filter({ hasText: `合成人员${i}` });
        await expect(r).toContainText(tax);
        await expect(r).toContainText(net);
      }
      await salary.getByRole('checkbox').first().check();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出所选工资条' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('工资条-202601.xlsx');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile((await download.path())!);
      const sheet = workbook.worksheets[0]!;
      expect(sheet.rowCount).toBe(4);
      expect(sheet.getRow(2).values).toContain(10850);
      expect(sheet.getRow(4).values).toContain(2480);
      // 观察真实 printHtml 生成的 iframe 内容，无凭证/余额接口替身。
      const printed = page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const observer = new MutationObserver((records) => {
              for (const record of records)
                for (const node of record.addedNodes)
                  if (node instanceof HTMLIFrameElement) {
                    node.addEventListener(
                      'load',
                      () => {
                        observer.disconnect();
                        resolve(node.contentDocument?.body.textContent ?? '');
                      },
                      { once: true },
                    );
                  }
            });
            observer.observe(document.body, { childList: true });
          }),
      );
      await page.getByRole('button', { name: '打印所选工资条' }).click();
      expect(await printed).toContain('合成人员1');
      const salaryUrl = page.url();
      const batchId = Number(new URL(salaryUrl).searchParams.get('id'));
      // 先取消置数，确认真实持久化工资未改变；再仅对一人补齐零奖金并重算。
      await salary.getByRole('checkbox').first().uncheck();
      await salary.getByRole('row').filter({ hasText: '合成人员1' }).getByRole('checkbox').check();
      await page.getByRole('button', { name: '统一置数 / 粘贴' }).click();
      drawer = page.getByRole('dialog', { name: '统一置数 / Excel 粘贴' });
      await drawer.getByRole('combobox', { name: '置数栏目' }).click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('奖金', { exact: true })
        .click();
      await drawer.getByLabel('统一金额', { exact: true }).fill('100');
      await drawer.getByRole('button', { name: '预览修改范围' }).click();
      await expect(drawer.getByRole('row').filter({ hasText: '合成人员1' })).toContainText(
        '100.00',
      );
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      expect(
        (
          await callApi<Batch>(
            request,
            'm.payroll.batch',
            { id: batchId },
            { token, method: 'GET' },
          )
        ).rows[0]!.values.bonus,
      ).toBeUndefined();
      await page.getByRole('button', { name: '统一置数 / 粘贴' }).click();
      drawer = page.getByRole('dialog', { name: '统一置数 / Excel 粘贴' });
      await drawer.getByRole('combobox', { name: '置数栏目' }).click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('奖金', { exact: true })
        .click();
      await drawer.getByRole('button', { name: '预览修改范围' }).click();
      await drawer.getByRole('button', { name: '确认批量修改' }).click();
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await expect(drawer).not.toBeVisible();
      const modified = await callApi<Batch>(
        request,
        'm.payroll.batch',
        { id: batchId },
        { token, method: 'GET' },
      );
      expect(modified.rows.map((r) => r.values.bonus)).toEqual([0, undefined, undefined]);
      expect(modified.calculated).toBe(false);
      await page.getByRole('button', { name: '计算工资', exact: true }).click();
      await expect(salary.getByRole('row').filter({ hasText: '合成人员1' })).toContainText(
        '10,850.00',
      );
      await page.goto('/m/payroll/reports');
      for (let i = 1; i <= 3; i++)
        await select(page.getByRole('combobox', { name: '报告人员' }), `E00${i}`);
      await page.getByLabel('报表', { exact: true }).click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('票面计算', { exact: true })
        .click();
      await page.getByRole('button', { name: 'search 查询', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: '合成人员1' })).toContainText(
        '10,850.00',
      );
      const reportDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出报表 Excel' }).click();
      const reportFile = await reportDownload;
      expect(reportFile.suggestedFilename()).toBe('票面计算表.xlsx');
      const reportBook = new ExcelJS.Workbook();
      await reportBook.xlsx.readFile((await reportFile.path())!);
      expect(reportBook.worksheets[0]!.rowCount).toBe(4);
      await page.goto('/m/payroll/query');
      await page.getByRole('button', { name: '添加查询条件' }).click();
      await page.getByLabel('条件值1', { exact: true }).fill('合成人员2');
      await page.getByRole('button', { name: 'search 查询', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: '合成人员2' })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: '合成人员1' })).toHaveCount(0);
      await page.goto(
        `/m/payroll/query?category=1&from=202601&to=202601&run=1&conditions=${encodeURIComponent(JSON.stringify([{ field: 'gross', operator: 'contains', value: '1' }]))}`,
      );
      await expect(page.getByText(/查询条件不兼容/)).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: '合成人员' })).toHaveCount(0);
      await page.goto(`/m/payroll/batch?id=${batchId}`);
      await expect(page.getByRole('heading', { name: /202601 合成月薪/ })).toBeVisible();
      await page.getByRole('button', { name: '凭证设置与生成' }).click();
      drawer = page.getByRole('dialog', { name: '工资凭证设置与生成' });
      for (const [label, code] of [
        ['应付工资科目', '2211'],
        ['银行或现金科目', '1001'],
        ['个税贷方科目', '222102'],
        ['个人扣款贷方科目', '2241'],
        ['费用分配借方科目', '6602'],
      ])
        await select(drawer.getByLabel(label!), code!);
      await drawer.getByRole('button', { name: '保存凭证设置' }).click();
      await drawer.getByRole('button', { name: '预览凭证' }).click();
      await expect(drawer.getByText('借方合计 99,000.00 / 贷方合计 99,000.00')).toBeVisible();
      await drawer.getByRole('button', { name: '确认生成凭证' }).click();
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await expect(drawer).not.toBeVisible();
      const url = page.url(),
        id = Number(new URL(url).searchParams.get('id'));
      const saved = await callApi<Batch>(
        request,
        'm.payroll.batch',
        { id },
        { token, method: 'GET' },
      );
      expect(saved.snapshots.map((r) => r.taxAmount)).toEqual([15000, 78000, 248000]);
      expect(saved.vouchers).toHaveLength(1);
      const voucher = (await svc.vouchers.get(saved.vouchers[0]!.id))!;
      expect(voucher.status).toBe('pending');
      expect(voucher.debitTotal).toBe(9900000);
      expect(voucher.creditTotal).toBe(voucher.debitTotal);
      expect(voucher.source).toEqual({ module: 'payroll', type: 'batch', id: String(id) });
      await page.reload();
      await expect(page.getByText('发放凭证 记-0001（待审核）', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '凭证设置与生成' }).click();
      drawer = page.getByRole('dialog', { name: '工资凭证设置与生成' });
      await drawer.getByRole('button', { name: '预览凭证' }).click();
      await expect(page.getByText('该批次该种类已生成凭证', { exact: true })).toBeVisible();
      expect((await svc.vouchers.list({})).items).toHaveLength(1);
      await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: '编辑工资', exact: true })).toHaveCount(0);
      await expect(
        callApi(request, 'm.payroll.calculate', { id, revision: saved.revision }, { token }),
      ).rejects.toThrow('已经结账或生成凭证');
      await page.getByRole('button', { name: '工资结账', exact: true }).click();
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await expect(page.getByRole('button', { name: '工资反结账', exact: true })).toBeVisible();
      const carried = await callApi<{ id: number }[]>(
        request,
        'm.payroll.batches',
        { period: 202602 },
        { token, method: 'GET' },
      );
      expect(carried).toHaveLength(1);
      const feb = await callApi<Batch>(
        request,
        'm.payroll.batch',
        { id: carried[0]!.id },
        { token, method: 'GET' },
      );
      expect(feb.rows[0]!.values).toEqual({ base: 1000000 });
      expect(feb.rows[0]!.tax.confirmed).toBe(false);
      expect((await svc.periods.get(202601))!.status).toBe('open');
      await page.getByRole('button', { name: '工资反结账', exact: true }).click();
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await expect(
        page.getByText('该工资来源凭证已审核或过账，不能反结账', { exact: true }),
      ).toBeVisible();
      await page.getByRole('link', { name: /发放凭证/ }).click();
      await expect(page).toHaveURL(new RegExp(`/m/voucher-entry/edit\\?id=${voucher.id}$`));
    } finally {
      await context.close();
      await request.dispose();
    }
  } finally {
    await runtime.bookStore.closeAll();
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
