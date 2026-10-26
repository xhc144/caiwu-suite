import { BusinessError, type Voucher, type VoucherLine } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  ContractFilterSchema,
  ContractInputSchema,
  type ContractFilter,
  type ContractInput,
} from '../contracts';
import type { AnalysisTables } from './migrations';
import { cents, sum } from './fifo';

function fail(code: string, message: string, hint = '刷新合同后检查资料，再重新操作'): never {
  throw new BusinessError({ code: `ANALYSIS_CONTRACT_${code}`, message, hint });
}
export function contractService(svc: CoreServices) {
  const db = svc.db.withTables<AnalysisTables>();
  async function requireContract(id: number, revision?: number) {
    const row = await db
      .selectFrom('analysis_contract')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) fail('NOT_FOUND', '合同不存在');
    if (revision !== undefined && row.revision !== revision) fail('STALE', '合同已被另一窗口修改');
    return row;
  }
  async function used(id: number) {
    return !!(await db
      .selectFrom('analysis_contract_line')
      .select('line_id')
      .where('contract_id', '=', id)
      .executeTakeFirst());
  }
  async function bump(id: number) {
    await db
      .updateTable('analysis_contract')
      .set((e) => ({ revision: e('revision', '+', 1) }))
      .where('id', '=', id)
      .execute();
  }
  async function audit(action: string, id: number, summary: string) {
    await svc.log.write({
      action: `analysis.contract.${action}`,
      summary,
      targetType: 'analysis_contract',
      targetId: id,
    });
  }
  async function requireSettlementAccount(accountId: number) {
    const account = await svc.accounts.get(accountId);
    if (
      !account ||
      account.disabled ||
      !account.isLeaf ||
      !(account.isCash || account.isBank) ||
      !account.dimensions.some((v) => v.type === 'partner')
    )
      fail(
        'ACCOUNT',
        '收付款科目须为启用客供核算的末级现金或银行科目',
        '请在基础档案中选择或建立明确记录客供的现金银行明细科目',
      );
    return account;
  }
  async function readableManualVoucher(voucherId: number) {
    // sources 当前只有路由元数据，没有可执行的来源读取授权契约。
    // 先只读来源标记；不得先 core.get 再将拒绝转换成逐行 reason。
    const header = await db
      .selectFrom('voucher')
      .select(['source_module', 'source_type', 'source_id'])
      .where('id', '=', voucherId)
      .executeTakeFirst();
    if (
      !header ||
      header.source_module !== null ||
      header.source_type !== null ||
      header.source_id !== null
    )
      fail(
        'VOUCHER_READ_DENIED',
        '凭证或分录不存在，或属于当前不能读取的来源单据',
        '本模块目前只处理无来源标记的手工凭证；其他凭证请在已获授权的来源模块查看',
      );
    const voucher = await svc.vouchers.get(voucherId);
    if (!voucher)
      fail(
        'VOUCHER_READ_DENIED',
        '凭证或分录不存在，或属于当前不能读取的来源单据',
        '本模块目前只处理无来源标记的手工凭证；其他凭证请在已获授权的来源模块查看',
      );
    return voucher;
  }
  async function get(id: number) {
    const row = await requireContract(id);
    const partner = await svc.dimensions.get(row.partner_id);
    const account = await svc.accounts.get(row.account_id);
    const users = await db
      .selectFrom('app_user')
      .select(['id', 'name'])
      .where('id', 'in', [row.created_by, row.reviewed_by ?? row.created_by])
      .execute();
    const links = await db
      .selectFrom('analysis_contract_line')
      .selectAll()
      .where('contract_id', '=', id)
      .execute();
    const lines = [];
    for (const link of links) {
      const entry = await db
        .selectFrom('voucher_line')
        .select('voucher_id')
        .where('id', '=', link.line_id)
        .executeTakeFirstOrThrow();
      const voucher = await readableManualVoucher(entry.voucher_id);
      const line = voucher.lines.find((l) => l.id === link.line_id)!;
      lines.push({
        ...link,
        voucherId: voucher.id,
        displayNo: voucher.displayNo,
        date: voucher.date,
        status: voucher.status,
        voided: voucher.voided,
        accountCode: line.accountCode,
        summary: line.summary,
        amount: cents(row.kind === 'receipt' ? line.debit - line.credit : line.credit - line.debit),
      });
    }
    return {
      ...row,
      partnerName: partner ? `${partner.code} ${partner.name}` : '客供未知',
      accountCode: account?.code ?? '',
      creatorName: users.find((u) => u.id === row.created_by)?.name ?? '未知',
      reviewerName: users.find((u) => u.id === row.reviewed_by)?.name ?? null,
      lines,
    };
  }
  function validateLine(
    contract: Awaited<ReturnType<typeof requireContract>>,
    voucher: Voucher,
    line: VoucherLine,
  ) {
    if (voucher.status !== 'posted' || voucher.voided) fail('STATUS', '只能关联未作废的已过账凭证');
    if (voucher.source)
      fail(
        'SOURCE',
        '来源单据凭证不能在合同中关联',
        '请保留来源模块对凭证的控制；当前仅支持手工凭证',
      );
    if (line.accountId !== contract.account_id) fail('ACCOUNT', '分录不是合同指定的收付款科目');
    if (line.dimensions.partner !== contract.partner_id)
      fail(
        'PARTNER',
        '合同客供与分录客供不一致',
        '请使用明确记录同一客供的现金银行分录，不按摘要或对方行猜测',
      );
    const amount = cents(
      contract.kind === 'receipt' ? line.debit - line.credit : line.credit - line.debit,
    );
    if (amount <= 0)
      fail(
        'DIRECTION',
        '分录方向与合同收付款类型不一致',
        '当前仅支持正向整条收款或付款分录，退款与拆分关联尚未实现',
      );
    return amount;
  }
  return {
    async list() {
      const rows = await db
        .selectFrom('analysis_contract as c')
        .innerJoin('dimension_item as p', 'p.id', 'c.partner_id')
        .selectAll('c')
        .select('p.name as partnerName')
        .orderBy('c.code')
        .limit(1001)
        .execute();
      if (rows.length > 1000)
        fail(
          'LIMIT',
          '合同超过1000条，未输出截断列表',
          '请联系管理员安排分页支持；合同号已知时可通过详情链接打开',
        );
      return rows;
    },
    get: (id: number) => svc.tx((s) => contractService(s).detail(id)),
    detail: get,
    async save(raw: ContractInput) {
      const input = ContractInputSchema.parse(raw);
      return svc.tx(async (s) => {
        const d = s.db.withTables<AnalysisTables>();
        const current = input.id ? await contractService(s).detail(input.id) : null;
        if (current && current.revision !== input.expectedRevision)
          fail('STALE', '合同已被另一窗口修改');
        if (!current && input.expectedRevision !== 0) fail('STALE', '新合同的版本应为0');
        if (current?.reviewed_by || current?.lines.length)
          fail('LOCKED', '已审核或已使用的合同不能修改', '先取消分录关联，再由原审核人取消审核');
        const duplicate = await d
          .selectFrom('analysis_contract')
          .select('id')
          .where('code', '=', input.code)
          .executeTakeFirst();
        if (duplicate && duplicate.id !== input.id)
          fail('DUPLICATE', '合同号已存在', '请输入当前账套中唯一的合同号');
        const partner = await s.dimensions.get(input.partnerId);
        if (!partner || partner.typeId !== 'partner' || partner.disabled || !partner.isLeaf)
          fail('PARTNER', '请选择启用的末级客供');
        const account = await s.accounts.get(input.accountId);
        if (
          !account ||
          account.disabled ||
          !account.isLeaf ||
          !(account.isCash || account.isBank) ||
          !account.dimensions.some((v) => v.type === 'partner')
        )
          fail(
            'ACCOUNT',
            '收付款科目须为启用客供核算的末级现金或银行科目',
            '请在基础档案中选择或建立明确记录客供的现金银行明细科目',
          );
        const row = {
          code: input.code,
          name: input.name,
          partner_id: input.partnerId,
          account_id: input.accountId,
          signed_date: input.signedDate,
          kind: input.kind,
          amount: input.amount,
          opening: input.opening,
          description: input.description,
          remark: input.remark,
          revision: (current?.revision ?? 0) + 1,
        };
        const saved = current
          ? await d
              .updateTable('analysis_contract')
              .set(row)
              .where('id', '=', current.id)
              .returning('id')
              .executeTakeFirstOrThrow()
          : await d
              .insertInto('analysis_contract')
              .values({ ...row, created_by: s.user.id, reviewed_by: null })
              .returning('id')
              .executeTakeFirstOrThrow();
        await s.log.write({
          action: 'analysis.contract.save',
          summary: `保存合同 ${input.code}`,
          targetType: 'analysis_contract',
          targetId: saved.id,
        });
        return contractService(s).detail(saved.id);
      });
    },
    async review(input: { id: number; expectedRevision: number; reviewed: boolean }) {
      return svc.tx(async (s) => {
        const service = contractService(s);
        const row = await service.detail(input.id);
        if (row.revision !== input.expectedRevision) fail('STALE', '合同已被另一窗口修改');
        if (!input.reviewed && row.reviewed_by !== s.user.id)
          fail('REVIEWER', '需要原审核人本人取消审核');
        if (!input.reviewed && row.lines.length)
          fail('USED', '已使用的合同不能取消审核', '先明确取消全部分录关联');
        if (input.reviewed && row.reviewed_by) fail('REVIEWED', '合同已审核');
        await s.db
          .withTables<AnalysisTables>()
          .updateTable('analysis_contract')
          .set({ reviewed_by: input.reviewed ? s.user.id : null, revision: row.revision + 1 })
          .where('id', '=', input.id)
          .execute();
        await s.log.write({
          action: 'analysis.contract.review',
          summary: `${input.reviewed ? '审核' : '取消审核'}合同 ${row.code}`,
          targetType: 'analysis_contract',
          targetId: row.id,
        });
        return service.detail(row.id);
      });
    },
    async remove(input: { id: number; expectedRevision: number; confirmed: boolean }) {
      return svc.tx(async (s) => contractService(s).removeInTransaction(input));
    },
    async removeInTransaction(input: { id: number; expectedRevision: number; confirmed: boolean }) {
      const row = await requireContract(input.id, input.expectedRevision);
      if (!input.confirmed) fail('CONFIRM', '删除合同需要明确确认');
      if (await used(row.id)) fail('USED', '此合同已经使用，不能删除');
      if (row.reviewed_by) fail('REVIEWED', '已审核合同不能删除', '请原审核人先取消审核');
      await db.deleteFrom('analysis_contract').where('id', '=', row.id).execute();
      await audit('delete', row.id, `删除合同 ${row.code}`);
    },
    async candidates(id: number, voucherId: number) {
      return svc.tx(async (s) => contractService(s).candidatesInTransaction(id, voucherId));
    },
    async candidatesInTransaction(id: number, voucherId: number) {
      const contract = await requireContract(id);
      await requireSettlementAccount(contract.account_id);
      const voucher = await readableManualVoucher(voucherId);
      const linked = new Set(
        (
          await db
            .selectFrom('analysis_contract_line')
            .select('line_id')
            .where(
              'line_id',
              'in',
              voucher.lines.map((l) => l.id),
            )
            .execute()
        ).map((l) => l.line_id),
      );
      return {
        voucherId,
        displayNo: voucher.displayNo,
        date: voucher.date,
        lines: voucher.lines.map((line) => {
          let reason: string | null = null;
          try {
            validateLine(contract, voucher, line);
            if (linked.has(line.id)) fail('LINKED', '这条分录已经关联合同');
          } catch (error) {
            if (!(error instanceof BusinessError)) throw error;
            reason = error.data.message;
          }
          return {
            lineId: line.id,
            accountCode: line.accountCode,
            summary: line.summary,
            debit: line.debit,
            credit: line.credit,
            reason,
          };
        }),
      };
    },
    async link(input: { id: number; expectedRevision: number; voucherId: number; lineId: number }) {
      return svc.tx(async (s) => contractService(s).linkInTransaction(input));
    },
    async linkInTransaction(input: {
      id: number;
      expectedRevision: number;
      voucherId: number;
      lineId: number;
    }) {
      const contract = await requireContract(input.id, input.expectedRevision);
      if (!contract.reviewed_by) fail('REVIEW_REQUIRED', '请先审核合同再关联收付款');
      await requireSettlementAccount(contract.account_id);
      const voucher = await readableManualVoucher(input.voucherId);
      const line = voucher?.lines.find((l) => l.id === input.lineId);
      if (!voucher || !line) fail('LINE', '凭证或分录不存在');
      validateLine(contract, voucher, line);
      if (
        await db
          .selectFrom('analysis_contract_line')
          .select('line_id')
          .where('line_id', '=', line.id)
          .executeTakeFirst()
      )
        fail('LINKED', '这条分录已经关联合同', '整条分录只能关联一个合同，请先核对并取消原关联');
      await db
        .insertInto('analysis_contract_line')
        .values({
          line_id: line.id,
          contract_id: contract.id,
          linked_by: svc.user.id,
          linked_at: svc.ctx.now().toISOString(),
        })
        .execute();
      await bump(contract.id);
      await audit(
        'link',
        contract.id,
        `合同 ${contract.code} 关联 ${voucher.displayNo} 分录 ${line.lineNo}`,
      );
      return get(contract.id);
    },
    async unlink(input: {
      id: number;
      expectedRevision: number;
      lineId: number;
      confirmed: boolean;
    }) {
      return svc.tx(async (s) => contractService(s).unlinkInTransaction(input));
    },
    async unlinkInTransaction(input: {
      id: number;
      expectedRevision: number;
      lineId: number;
      confirmed: boolean;
    }) {
      const contract = await requireContract(input.id, input.expectedRevision);
      if (!input.confirmed) fail('CONFIRM', '取消分录关联需要明确确认');
      const result = await db
        .deleteFrom('analysis_contract_line')
        .where('contract_id', '=', contract.id)
        .where('line_id', '=', input.lineId)
        .executeTakeFirst();
      if (!result.numDeletedRows) fail('LINK', '这条分录未关联当前合同');
      await bump(contract.id);
      await audit('unlink', contract.id, `合同 ${contract.code} 取消分录 ${input.lineId} 关联`);
      return get(contract.id);
    },
    async report(raw: ContractFilter) {
      const f = ContractFilterSchema.parse(raw);
      return svc.tx(async (s) => {
        const book = await s.book.info();
        const openingDate = `${Math.floor(book.startPeriod / 100)}-${String(book.startPeriod % 100).padStart(2, '0')}-01`;
        if (f.from < openingDate)
          fail(
            'BEFORE_START',
            '收付查询早于账套启用日期',
            '期初收付款只作为启用日以前累计，不能推算其历史期间发生额',
          );
        let q = s.db
          .withTables<AnalysisTables>()
          .selectFrom('analysis_contract')
          .select('id')
          .where('signed_date', '>=', f.signedFrom)
          .where('signed_date', '<=', f.signedTo)
          .orderBy('code')
          .limit(1001);
        if (f.partnerId) q = q.where('partner_id', '=', f.partnerId);
        if (f.kind !== 'all') q = q.where('kind', '=', f.kind);
        const ids = await q.execute();
        if (ids.length > 1000)
          fail('LIMIT', '合同超过1000条，未输出截断结果', '请缩小签订日期或客供范围');
        const rows = [];
        for (const { id } of ids) {
          const row = await contractService(s).detail(id);
          if (row.lines.some((l) => l.status !== 'posted' || l.voided))
            fail(
              'INACTIVE_LINK',
              `合同 ${row.code} 的关联凭证已反过账或作废，无法生成完整报告`,
              '请恢复原凭证状态或在合同详情中明确取消关联后再查询',
            );
          const through = row.lines.filter((l) => l.date <= f.to);
          const current = sum(through.filter((l) => l.date >= f.from).map((l) => l.amount));
          const cumulative = sum([row.opening, ...through.map((l) => l.amount)]);
          rows.push({
            ...row,
            current,
            cumulative,
            remaining: sum([row.amount, -cumulative]),
            dueDate: null,
            overdueDays: null,
          });
        }
        return {
          filter: f,
          generatedAt: s.ctx.now().toISOString(),
          openingDate,
          baseCurrency: book.baseCurrency,
          rows,
          totals: {
            amount: sum(rows.map((r) => r.amount)),
            opening: sum(rows.map((r) => r.opening)),
            current: sum(rows.map((r) => r.current)),
            cumulative: sum(rows.map((r) => r.cumulative)),
            remaining: sum(rows.map((r) => r.remaining)),
          },
        };
      });
    },
  };
}
export type ContractReport = Awaited<ReturnType<ReturnType<typeof contractService>['report']>>;
