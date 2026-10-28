import { BusinessError, DIMENSION_TYPES, formatPeriod, notFound, sumCents } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  defaultSettings,
  SettingsSchema,
  TemplateSchema,
  type Settings,
  type PrintTemplate,
  type VoucherSelection,
  type LedgerSelection,
} from '../shared';
import type { PrintSettingsTables } from './migrations';
const fail = (message: string, hint = '调整筛选条件后重新预览') =>
  new BusinessError({ code: 'PRINT_INVALID', message, hint });
export function printService(svc: CoreServices) {
  const db = svc.db.withTables<PrintSettingsTables>();
  const self = {
    async settings() {
      try {
        return SettingsSchema.parse(await svc.settings.get('layouts', defaultSettings));
      } catch {
        throw fail('打印设置数据读取失败', '请联系管理员检查账套或从有效备份恢复打印设置');
      }
    },
    async saveSettings(data: Settings) {
      const s = SettingsSchema.parse(data);
      await svc.tx(async (t) => {
        await t.settings.set('layouts', s);
        await t.log.write({ action: 'print.settings', summary: '保存凭证和账簿打印设置' });
      });
      return s;
    },
    async vouchers(input: VoucherSelection) {
      svc.permissions.require('print-settings.voucher.print');
      const info = await svc.book.info();
      let ids: number[];
      if (input.voucherId) ids = [input.voucherId];
      else if (input.order === 'queried') ids = input.ids ?? [];
      else {
        const list = await svc.vouchers.list({
          periodFrom: input.from,
          periodTo: input.to,
          voucherTypeId: input.type,
          numberFrom: input.numberFrom,
          numberTo: input.numberTo,
          limit: 1000,
        });
        if (list.total > 1000) throw fail('凭证超过 1000 张，请缩小范围分批打印');
        ids = list.items.map((v) => v.id);
      }
      if (!ids.length)
        throw fail(
          input.order === 'queried' ? '请先查询并选择要打印的凭证' : '无记录，无法预览/打印',
        );
      const vouchers = [];
      const dimensionMaps = await Promise.all(
        DIMENSION_TYPES.map(
          async (d) =>
            [
              d.id,
              new Map((await svc.dimensions.items(d.id)).map((x) => [x.id, `${x.code} ${x.name}`])),
            ] as const,
        ),
      );
      const maps = new Map(dimensionMaps);
      for (const id of ids) {
        const v = await svc.vouchers.get(id);
        if (!v) throw notFound('当前账套凭证', id);
        if (v.voided || v.number == null) throw fail(`${v.displayNo} 为草稿或作废凭证，请重新选择`);
        vouchers.push({
          ...v,
          auxiliary: v.lines.map((l) =>
            DIMENSION_TYPES.flatMap((d) => {
              const id = l.dimensions[d.id];
              return id ? [`${d.name}：${maps.get(d.id)?.get(id) ?? '未找到辅助项'}`] : [];
            }).join('；'),
          ),
        });
      }
      return { unit: info.orgName, vouchers };
    },
    async ledger(input: LedgerSelection) {
      svc.permissions.require('print-settings.ledger.print');
      const account = await svc.accounts.require(input.account);
      if (input.kind === 'cash' && !account.isCash)
        throw fail('现金日记账需要现金科目', '请选择现金科目');
      if (input.kind === 'bank' && !account.isBank)
        throw fail('银行日记账需要银行科目', '请选择银行科目');
      const filter = {
        periodFrom: input.from,
        periodTo: input.to,
        includeUnposted: input.includeUnposted,
      };
      const balances = await svc.ledger.balances({
        ...filter,
        accountCodes: [account.code],
        includeZero: true,
      });
      const b = balances.find((x) => x.accountId === account.id);
      const entries = await svc.ledger.entries({
        ...filter,
        accountCode: account.code,
        limit: 200000,
      });
      if (entries.length >= 200000) throw fail('分录达到打印上限，请缩小期间范围');
      const opening = b?.opening ?? 0,
        debit = b?.debit ?? 0,
        credit = b?.credit ?? 0;
      const hasOpeningOrCumulative =
        opening !== 0 || (b?.ytdDebit ?? 0) !== 0 || (b?.ytdCredit ?? 0) !== 0;
      if (
        !entries.length &&
        !(input.printNoActivity && (hasOpeningOrCumulative || input.printEmpty))
      )
        throw new BusinessError({
          code: 'PRINT_NO_ACTIVITY',
          message: '无记录，无法预览/打印',
          hint: '如需有期初数或累计数的科目，请勾选打印无发生；空科目还需勾选打印空科目',
        });
      const info = await svc.book.info();
      let balance = opening;
      const counterpart = new Map<number, string>();
      if (input.kind === 'cash')
        for (const id of new Set(entries.map((r) => r.voucherId))) {
          const v = await svc.vouchers.get(id);
          counterpart.set(
            id,
            [
              ...new Set(
                v?.lines
                  .filter((l) => !l.accountCode.startsWith(account.code))
                  .map((l) => `${l.accountCode} ${l.accountName}`),
              ),
            ].join('、'),
          );
        }
      let rows = entries.map((r) => {
        balance = sumCents([balance, r.debit, -r.credit]);
        return {
          id: String(r.lineId),
          date: r.date,
          voucherNo: r.displayNo,
          summary: r.summary,
          debit: r.debit,
          credit: r.credit,
          balance,
          counterpart: counterpart.get(r.voucherId) ?? '',
          refNo: r.refNo ?? '',
          quantity: r.quantity,
        };
      });
      if (input.kind === 'general') {
        let running = opening;
        const periods = [...new Set(entries.map((e) => e.period))];
        rows = periods.map((p) => {
          const subset = entries.filter((e) => e.period === p),
            d = sumCents(subset.map((e) => e.debit)),
            c = sumCents(subset.map((e) => e.credit));
          running = sumCents([running, d, -c]);
          return {
            id: String(p),
            date: formatPeriod(p),
            voucherNo: '',
            summary: '本月发生额',
            debit: d,
            credit: c,
            balance: running,
            counterpart: '',
            refNo: '',
            quantity: null,
          };
        });
      }
      if (!rows.length)
        rows = [
          {
            id: 'empty',
            date: '',
            voucherNo: '',
            summary: '本期无发生',
            debit: 0,
            credit: 0,
            balance: opening,
            counterpart: '',
            refNo: '',
            quantity: null,
          },
        ];
      return {
        unit: info.orgName,
        title: { general: '总分类账', detail: '明细账', cash: '现金日记账', bank: '银行日记账' }[
          input.kind
        ],
        kind: input.kind,
        period: `${formatPeriod(input.from)} 至 ${formatPeriod(input.to)}`,
        account: `${account.code} ${account.fullName}`,
        opening,
        debit,
        credit,
        ytdDebit: b?.ytdDebit ?? 0,
        ytdCredit: b?.ytdCredit ?? 0,
        rows,
      };
    },
    async ledgerBook(input: LedgerSelection) {
      return (await self.ledgerBatch(input)).models;
    },
    async ledgerBatch(input: LedgerSelection) {
      svc.permissions.require('print-settings.ledger.print');
      const scope = input.accountScope ?? 'selected';
      const models: Awaited<ReturnType<typeof self.ledger>>[] = [];
      const skipped: string[] = [];
      await svc.tx(async (snapshot) => {
        const codes =
          scope === 'selected'
            ? [...new Set(input.account.split(',').map((x) => x.trim()))]
            : (await snapshot.accounts.list())
                .filter(
                  (a) =>
                    (scope === 'all' || (scope === 'first' ? a.level === 1 : a.isLeaf)) &&
                    (input.kind !== 'cash' || a.isCash) &&
                    (input.kind !== 'bank' || a.isBank),
                )
                .map((a) => a.code);
        if (scope === 'selected' && (codes.length > 50 || codes.some((c) => !c)))
          throw fail('请填写 1 至 50 个科目编码，以逗号分隔');
        for (const account of codes) {
          try {
            models.push(await printService(snapshot).ledger({ ...input, account }));
          } catch (error) {
            if (!(error instanceof BusinessError) || error.data.code !== 'PRINT_NO_ACTIVITY')
              throw error;
            skipped.push(account);
          }
        }
      });
      if (!models.length)
        throw fail(
          '所选科目均无符合条件的记录，无法预览/打印',
          '调整期间、科目范围或无发生科目选项后重试',
        );
      return { models, skipped };
    },
    async formats() {
      return (
        await db.selectFrom('print_settings_format').selectAll().orderBy('code').execute()
      ).map((r) => {
        try {
          return { ...TemplateSchema.parse(JSON.parse(r.definition)), revision: r.revision };
        } catch {
          throw fail(
            `格式 ${r.code} 的格式数据缺失或读取失败`,
            '请从有效备份恢复该格式；不会创建空格式',
          );
        }
      });
    },
    async saveFormat(data: PrintTemplate, revision?: number) {
      const value = TemplateSchema.parse(data);
      return svc.tx(async (t) => {
        const td = t.db.withTables<PrintSettingsTables>();
        const old = await td
          .selectFrom('print_settings_format')
          .selectAll()
          .where('code', '=', value.code)
          .executeTakeFirst();
        if (old && revision == null) throw fail('格式编码重复', '请选择一个未使用的 0 至 99 编码');
        if (revision != null && (!old || old.revision !== revision))
          throw fail('格式已被修改或删除', '重新打开格式后再修改');
        if (old)
          await td
            .updateTable('print_settings_format')
            .set({
              name: value.name,
              definition: JSON.stringify(value),
              revision: old.revision + 1,
            })
            .where('code', '=', value.code)
            .execute();
        else
          await td
            .insertInto('print_settings_format')
            .values({
              code: value.code,
              name: value.name,
              definition: JSON.stringify(value),
              revision: 1,
            })
            .execute();
        await t.log.write({
          action: 'print.format.save',
          summary: `保存打印格式 ${value.code}`,
          targetId: value.code,
        });
        return printService(t).formats();
      });
    },
    async copyFormat(source: number, code: number, name: string) {
      const format = (await self.formats()).find((f) => f.code === source);
      if (!format) throw fail('未选择格式或当前账套格式数据缺失', '请选择当前账套中存在的格式');
      return self.saveFormat({ ...format, code, name });
    },
    async removeFormat(code: number, confirmed: boolean) {
      if (!confirmed) throw fail('删除格式需要确认', '确认删除后重试');
      const exists = (await self.formats()).some((f) => f.code === code);
      if (!exists) throw notFound('当前账套格式', code);
      await svc.tx(async (t) => {
        await t.db
          .withTables<PrintSettingsTables>()
          .deleteFrom('print_settings_format')
          .where('code', '=', code)
          .execute();
        await t.log.write({ action: 'print.format.delete', summary: `删除打印格式 ${code}` });
      });
    },
  };
  return self;
}
