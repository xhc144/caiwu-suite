import { balanceFormula, type ReportTemplate } from '../../shared';
import { balanceAddress } from './catalogue';

/** small-appendix.pdf 第70页列明的十项组成；4001的在产品口径见第54—55页。 */
export const inventoryRoles = [
  { role: 'purchases', code: '1401', name: '材料采购' },
  { role: 'inTransit', code: '1402', name: '在途物资' },
  { role: 'rawMaterials', code: '1403', name: '原材料' },
  { role: 'materialVariance', code: '1404', name: '材料成本差异' },
  { role: 'workInProgress', code: '4001', name: '生产成本（在产品）' },
  { role: 'finishedGoods', code: '1405', name: '库存商品' },
  { role: 'merchandiseVariance', code: '1407', name: '商品进销差价' },
  { role: 'outsourcedProcessing', code: '1408', name: '委托加工物资' },
  { role: 'turnoverMaterials', code: '1411', name: '周转材料' },
  { role: 'consumableBiologicalAssets', code: '1421', name: '消耗性生物资产' },
] as const;

export type InventoryRole = (typeof inventoryRoles)[number]['role'];
export type InventoryMapping = Record<
  InventoryRole,
  { accounts: readonly string[] } | { absent: { reason: string } }
>;
export type InventoryAccount = { code: string; isLeaf: boolean };
export type InventoryConfiguration = {
  mapping: InventoryMapping;
  /** 必须传当前账套完整科目表，不能只传已选明细。不是持久绑定或公共生成门禁。 */
  accounts: readonly InventoryAccount[];
};

export const officialInventoryMapping: InventoryMapping = {
  purchases: { accounts: ['1401'] },
  inTransit: { accounts: ['1402'] },
  rawMaterials: { accounts: ['1403'] },
  materialVariance: { accounts: ['1404'] },
  workInProgress: { accounts: ['4001'] },
  finishedGoods: { accounts: ['1405'] },
  merchandiseVariance: { accounts: ['1407'] },
  outsourcedProcessing: { accounts: ['1408'] },
  turnoverMaterials: { accounts: ['1411'] },
  consumableBiologicalAssets: { accounts: ['1421'] },
};

/**
 * 仅供有完整科目表的显式模板构造；只认可本表标准母科目下的完整覆盖。
 * 缺角色、漏明细、父子重复都拒绝。不存在须同时有文字依据和完整科目表佐证。
 * 该检查没有接入公共router，不能代替生成时的原子预检或持久profile。
 * 验证通过仅表示当前快照一致，不代表允许输出依赖此快照的模板。
 */
export function validateInventoryMapping(
  mapping: InventoryMapping,
  accounts: readonly InventoryAccount[],
) {
  if (!accounts.length) throw new Error('存货映射需要当前账套完整科目表，不能传空表');
  if (new Set(accounts.map((a) => a.code)).size !== accounts.length)
    throw new Error('存货映射的科目表有重复编码');
  const roles = inventoryRoles.map((r) => r.role);
  if (Object.keys(mapping).some((role) => !roles.includes(role as InventoryRole)))
    throw new Error('存货映射含未知组成角色，不能静默忽略');
  const used: string[] = [];
  for (const { role, code: root, name } of inventoryRoles) {
    const entry = mapping[role];
    if (!entry) throw new Error(`存货组成缺少${name}角色，不能默认按零`);
    const chart = accounts.filter((a) => a.code.startsWith(root));
    if ('absent' in entry) {
      if ('accounts' in entry || !entry.absent.reason.trim())
        throw new Error(`${name}不存在须有明确依据，不能同时映射科目`);
      if (chart.length) throw new Error(`${name}科目仍然存在，不能声明不存在`);
      continue;
    }
    if (!entry.accounts.length) throw new Error(`${name}须映射真实科目，不能传空数组`);
    for (const code of entry.accounts) {
      if (!/^\d{4,20}$/.test(code) || !code.startsWith(root))
        throw new Error(`${name}须映射${root}及其真实明细，不按名称猜科目`);
      if (used.some((old) => old.startsWith(code) || code.startsWith(old)))
        throw new Error(`${name}映射有重复或父子重叠，不能重复计入存货`);
      if (!chart.some((a) => a.code === code)) throw new Error(`${name}映射科目${code}不存在`);
      used.push(code);
    }
    const leaves = chart.filter((a) => a.isLeaf);
    if (!leaves.length || leaves.some((a) => !entry.accounts.some((c) => a.code.startsWith(c))))
      throw new Error(`${name}未完整覆盖真实末级明细，不能漏项按零`);
  }
}

function replace(t: ReportTemplate, address: string, source: string) {
  const cell = t.cells.find((c) => c.address === address);
  if (!cell) throw new Error(`存货模板缺少${address}`);
  Object.assign(cell, { kind: 'formula', source, unit: 'cents', currency: 'CNY' });
  const style = t.styles.find((s) => s.address === address);
  if (style) Object.assign(style, { align: 'right', format: 'decimal2', wrap: false });
}

/** 只通过真实BALANCE读取总账；不读库存批次，不分摊或写入存货成本。 */
export function applyInventoryBalances(t: ReportTemplate, config?: InventoryConfiguration) {
  if (config) validateInventoryMapping(config.mapping, config.accounts);
  // 默认十项全部强制引用；缺任一母科目由共享BALANCE.require明确报错，不回退零。
  const mapping = config?.mapping ?? officialInventoryMapping;
  // 公共引擎尚不能绑定/复核科目表版本。先拒绝所有依赖构造期快照的省略：
  // absent变常量零会漏掉以后新增的母科目，明细列表会漏掉以后新增的兄弟科目。
  // 必须在修改任何单元格之前阻止输出；不能用README提示或自校验等式代替门禁。
  for (const { role, code, name } of inventoryRoles) {
    const entry = mapping[role];
    if ('absent' in entry || entry.accounts.length !== 1 || entry.accounts[0] !== code)
      throw new Error(
        `${name}的不存在声明或明细映射需要公共生成/导出的科目版本原子绑定；当前不能构造该存货模板，请等待共享门禁后重新核实映射`,
      );
  }
  for (const column of ['closing', 'yearOpening'] as const) {
    const source = (role: InventoryRole) => {
      // 仅母科目范围可以随真实总账动态包含后续新增的所有明细。
      const account = inventoryRoles.find((r) => r.role === role)!.code;
      return balanceFormula({
        account,
        metric: column === 'closing' ? 'closing' : 'opening',
        unit: 'cents',
        currency: 'CNY',
        direction: 'signed',
        dimension: 'none',
        item: '',
        options:
          column === 'closing'
            ? { from: 'current', to: 'current' }
            : { from: 'yearStart', to: 'yearStart' },
      });
    };
    const total = inventoryRoles.map(({ role }) => `(${source(role)})`).join('+');
    replace(t, balanceAddress(9, column), total);
    for (const [line, role] of [
      [10, 'rawMaterials'],
      [11, 'workInProgress'],
      [12, 'finishedGoods'],
      [13, 'turnoverMaterials'],
    ] as const)
      replace(t, balanceAddress(line, column), source(role));
    const label = column === 'closing' ? '期末' : '年初';
    t.checks.push({
      name: `${label}存货等于十项有符号组成（差异不二次扣减）`,
      left: balanceAddress(9, column),
      right: total,
      tolerance: '0',
    });
    // 其中项1403/1405为原账面余额。先还原两项有符号差异，再检查四个其中项，
    // 否则贷方差异会使“存货>=其中项”对正常售价/计划成本账套产生假失败。
    const adjusted = [
      balanceAddress(9, column),
      `(${source('materialVariance')})`,
      `(${source('merchandiseVariance')})`,
    ].join('-');
    const included = [10, 11, 12, 13].map((line) => balanceAddress(line, column)).join('+');
    t.checks.push({
      name: `${label}存货剔除有符号差异后包含原材料、在产品、库存商品和周转材料`,
      left: `${adjusted}>=(${included})`,
      right: '1',
      tolerance: '0',
    });
  }
  const note = t.cells.find((c) => c.address === 'A39');
  if (note)
    note.source =
      '存货十项取总账有符号余额；在产品取生产成本末级明细；存货及其中项年初取年度期初。其它简单项目按年度累计还原。';
}
