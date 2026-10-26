import Decimal from 'decimal.js';
import { notFound } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  ReferenceInputSchema,
  type ReferenceInput,
  type ReferenceKind,
  type ReferenceRow,
} from '../shared';
import type { MasterdataTables } from './migrations';
import { fail, initials, protectReferences } from './service';

export function referenceService(svc: CoreServices) {
  const db = svc.db.withTables<MasterdataTables>();
  const self = {
    async list(kind: ReferenceKind): Promise<ReferenceRow[]> {
      const extra = await db
        .selectFrom('masterdata_reference_extra')
        .selectAll()
        .where('kind', '=', kind)
        .execute();
      const decorate = (id: number) => {
        const e = extra.find((e) => e.ref_id === id);
        return {
          fullName: e?.full_name ?? '',
          category: e?.category ?? '',
          shortcut: e?.shortcut ?? '',
        };
      };
      const base = {
        symbol: null,
        fullName: '',
        shortName: '',
        category: '',
        shortcut: '',
        useCount: 0,
        pinyin: '',
        isBase: false,
      };
      if (kind === 'currencies')
        return (
          await db.selectFrom('currency').selectAll().orderBy('sort').orderBy('code').execute()
        ).map((r, i) => ({
          ...base,
          id: i + 1,
          code: r.code,
          name: r.name,
          disabled: !!r.disabled,
          sort: r.sort,
          symbol: r.symbol,
          isBase: !!r.is_base,
          pinyin: initials(r.name),
        }));
      if (kind === 'summaries')
        return (
          await db.selectFrom('summary_phrase').selectAll().orderBy('sort').orderBy('id').execute()
        ).map((r) => ({
          ...base,
          ...decorate(r.id),
          id: r.id,
          code: r.code ?? '',
          name: r.text,
          disabled: false,
          sort: r.sort,
          useCount: r.use_count,
          pinyin: r.pinyin,
        }));
      const rows =
        kind === 'voucherTypes'
          ? await db.selectFrom('voucher_type').selectAll().orderBy('sort').orderBy('id').execute()
          : await db
              .selectFrom('settlement_method')
              .selectAll()
              .orderBy('sort')
              .orderBy('id')
              .execute();
      return rows.map((r) => ({
        ...base,
        ...decorate(r.id),
        id: r.id,
        code:
          kind === 'voucherTypes'
            ? extra.find((e) => e.ref_id === r.id)?.catalog_code || r.code
            : r.code,
        shortName: kind === 'voucherTypes' ? r.code : '',
        name: r.name,
        pinyin: initials(r.name),
        disabled: !!r.disabled,
        sort: r.sort,
      }));
    },
    async save(raw: ReferenceInput) {
      const data = ReferenceInputSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const service = referenceService(tsvc);
        const tdb = tsvc.db.withTables<MasterdataTables>();
        const rows = await service.list(data.kind);
        const before =
          data.id == null
            ? null
            : rows.find((r) =>
                data.kind === 'currencies' ? r.code === data.code : r.id === data.id,
              );
        if (data.id && !before) throw notFound('基础档案', data.id);
        const duplicate = rows.find((r) => r.code === data.code && r.id !== before?.id);
        if (duplicate)
          fail(
            'REFERENCE_DUPLICATE',
            `编码 ${data.code} 已存在`,
            '请更换编码，或编辑已有记录；摘要库编码也必须唯一',
          );
        const shortName = data.shortName || data.code;
        if (data.kind === 'voucherTypes') {
          if (shortName.length > 4)
            fail(
              'VOUCHER_SHORT_NAME',
              '凭证简称最多4个字',
              '代码与简称可分别填写，如代码01、简称收',
            );
          if (rows.some((r) => r.shortName === shortName && r.id !== before?.id))
            fail(
              'REFERENCE_DUPLICATE',
              `凭证简称 ${shortName} 已存在`,
              '请更换简称，以便在凭证头区分类型',
            );
        }
        if (before?.isBase && data.disabled)
          fail('BASE_CURRENCY', '本位币不能停用或删除', '基础档案不能改变账套本位币');
        if (
          data.disabled &&
          before &&
          !before.disabled &&
          ['voucherTypes', 'settlementMethods'].includes(data.kind) &&
          rows.filter((r) => !r.disabled).length === 1
        )
          fail('REFERENCE_LAST', '至少保留一个可用的凭证类型或结算类别', '请先新增并启用另一类别');
        let id = before?.id;
        if (data.kind === 'currencies') {
          if (!/^[A-Z]{3}$/.test(data.code))
            fail('CURRENCY_CODE', '币种代码须为3位大写字母，如 USD');
          const values = {
            name: data.name,
            symbol: data.symbol,
            disabled: +data.disabled,
            sort: data.sort,
          };
          if (before)
            await tdb.updateTable('currency').set(values).where('code', '=', data.code).execute();
          else
            await tdb
              .insertInto('currency')
              .values({ ...values, code: data.code, is_base: 0 })
              .execute();
          return;
        }
        if (data.kind === 'summaries') {
          const values = {
            code: data.code,
            text: data.name,
            pinyin: initials(data.name),
            sort: data.sort,
          };
          if (id)
            await tdb.updateTable('summary_phrase').set(values).where('id', '=', id).execute();
          else
            id = (
              await tdb
                .insertInto('summary_phrase')
                .values({ ...values, use_count: 0 })
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id;
        } else {
          const table = data.kind === 'voucherTypes' ? 'voucher_type' : 'settlement_method';
          // core 的凭证头用 code 显示凭证字，name 保存全称；不伪造未执行的 rule。
          const values = {
            code: data.kind === 'voucherTypes' ? shortName : data.code,
            name: data.name,
            disabled: +data.disabled,
            sort: data.sort,
          };
          if (id) {
            if (
              before?.shortName !== shortName &&
              data.kind === 'voucherTypes' &&
              (await tdb
                .selectFrom('voucher')
                .select('id')
                .where('voucher_type_id', '=', id)
                .limit(1)
                .executeTakeFirst())
            )
              fail('REFERENCE_USED', '凭证类型已使用，不能改变历史凭证字', '可修改说明或停用');
            await tdb.updateTable(table).set(values).where('id', '=', id).execute();
          } else
            id = (
              await tdb.insertInto(table).values(values).returning('id').executeTakeFirstOrThrow()
            ).id;
        }
        await tdb
          .insertInto('masterdata_reference_extra')
          .values({
            kind: data.kind,
            ref_id: id!,
            catalog_code: data.kind === 'voucherTypes' ? data.code : '',
            full_name: data.fullName,
            category: data.category,
            shortcut: data.shortcut,
          })
          .onConflict((o) =>
            o.columns(['kind', 'ref_id']).doUpdateSet({
              catalog_code: data.kind === 'voucherTypes' ? data.code : '',
              full_name: data.fullName,
              category: data.category,
              shortcut: data.shortcut,
            }),
          )
          .execute();
        if (before && before.code !== data.code)
          await tsvc.log.write({
            action: 'masterdata.reference.recode',
            summary: `基础档案编码 ${before.code} → ${data.code}`,
            targetType: data.kind,
            targetId: id,
          });
      });
    },
    async remove(kind: ReferenceKind, id: number, code: string, confirmed: boolean) {
      return protectReferences(() =>
        svc.tx(async (tsvc) => {
          const tdb = tsvc.db.withTables<MasterdataTables>();
          const rows = await referenceService(tsvc).list(kind);
          const row = rows.find((r) => (kind === 'currencies' ? r.code === code : r.id === id));
          if (!row) throw notFound('基础档案', code || id);
          if (kind === 'currencies') {
            if (row.isBase || row.code === (await tsvc.book.info()).baseCurrency)
              fail('BASE_CURRENCY', '本位币不能删除', '请保留账套本位币');
            const account = await tdb
              .selectFrom('account')
              .select('id')
              .where('currency_code', '=', code)
              .limit(1)
              .executeTakeFirst();
            const opening = await tdb
              .selectFrom('opening_balance')
              .select('id')
              .where('currency_code', '=', code)
              .limit(1)
              .executeTakeFirst();
            const line = await tdb
              .selectFrom('voucher_line')
              .select('id')
              .where('currency_code', '=', code)
              .limit(1)
              .executeTakeFirst();
            if (account ?? opening ?? line)
              fail(
                'CURRENCY_USED',
                '币种已被科目、期初或分录引用，不能删除',
                '可停用币种以保留历史',
              );
          } else if (kind !== 'summaries') {
            if (!row.disabled && rows.filter((r) => !r.disabled).length <= 1)
              fail('REFERENCE_LAST', '不能删除最后一个可用类别', '先新增并启用另一类别');
            const used =
              kind === 'voucherTypes'
                ? await tdb
                    .selectFrom('voucher')
                    .select('id')
                    .where('voucher_type_id', '=', id)
                    .limit(1)
                    .executeTakeFirst()
                : await tdb
                    .selectFrom('voucher_line')
                    .select('id')
                    .where('settlement_method_id', '=', id)
                    .limit(1)
                    .executeTakeFirst();
            if (used)
              fail('REFERENCE_USED', '类别已被凭证或分录使用，不能删除', '可停用以保留历史');
          }
          if (!confirmed) fail('CONFIRM_REQUIRED', '确认删除该未使用记录？');
          if (kind === 'currencies') {
            await tdb.deleteFrom('exchange_rate').where('currency_code', '=', code).execute();
            await tdb
              .deleteFrom('masterdata_currency_account')
              .where('currency_code', '=', code)
              .execute();
            await tdb.deleteFrom('currency').where('code', '=', code).execute();
          } else {
            const table =
              kind === 'voucherTypes'
                ? 'voucher_type'
                : kind === 'settlementMethods'
                  ? 'settlement_method'
                  : 'summary_phrase';
            await tdb.deleteFrom(table).where('id', '=', id).execute();
            await tdb
              .deleteFrom('masterdata_reference_extra')
              .where('kind', '=', kind)
              .where('ref_id', '=', id)
              .execute();
          }
          await tsvc.log.write({
            action: 'masterdata.reference.delete',
            summary: `删除基础档案 ${row.code} ${row.name}`,
            targetType: kind,
            targetId: kind === 'currencies' ? code : id,
          });
        }),
      );
    },
    async rates(currency: string) {
      return {
        rates: await db
          .selectFrom('exchange_rate')
          .selectAll()
          .where('currency_code', '=', currency)
          .orderBy('period', 'desc')
          .execute(),
        accountId:
          (
            await db
              .selectFrom('masterdata_currency_account')
              .select('account_id')
              .where('currency_code', '=', currency)
              .executeTakeFirst()
          )?.account_id ?? null,
      };
    },
    async saveRate(currency: string, period: number, rate: string, accountId: number | null) {
      if (!/^\d+(\.\d+)?$/.test(rate) || !new Decimal(rate).gt(0))
        fail('RATE', '汇率必须是正十进制字符串', '例如 7.123456，不接受指数格式或0');
      if (
        !Number.isInteger(period) ||
        period < 190001 ||
        period > 999912 ||
        period % 100 < 1 ||
        period % 100 > 12
      )
        fail('PERIOD', '期间须为合法年月，如202601');
      return svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<MasterdataTables>();
        const c = (await tsvc.reference.currencies()).find((c) => c.code === currency);
        if (!c || c.isBase || c.disabled) fail('CURRENCY', '请选择在用外币，本位币不维护汇率');
        if (accountId != null) {
          const a = await tsvc.accounts.require(accountId);
          if (!a.isLeaf || a.disabled) fail('EXCHANGE_ACCOUNT', '汇兑损益科目须为在用末级');
        }
        await tdb
          .insertInto('exchange_rate')
          .values({ currency_code: currency, period, rate: new Decimal(rate).toFixed() })
          .onConflict((o) =>
            o
              .columns(['currency_code', 'period'])
              .doUpdateSet({ rate: new Decimal(rate).toFixed() }),
          )
          .execute();
        await tdb
          .insertInto('masterdata_currency_account')
          .values({ currency_code: currency, account_id: accountId })
          .onConflict((o) => o.column('currency_code').doUpdateSet({ account_id: accountId }))
          .execute();
      });
    },
  };
  return self;
}
