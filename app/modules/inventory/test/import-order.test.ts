import { expect, it } from 'vitest';
import { IMPORT_ORDER_INCOMPLETE, nonnegativeImportOrder } from '../server/import-order';

function loans(count: number, lastNeedsTwo = false): Parameters<typeof nonnegativeImportOrder>[0] {
  return Array.from({ length: count }, (_, i) => {
    const n = lastNeedsTwo && i === count - 1 ? 2_000_000 : 1_000_000;
    return [
      {
        key: `O${i}`,
        kind: 'issue' as const,
        quantities: [['1:P', n]] as [string, number][],
        priority: 1,
      },
      {
        key: `R${i}`,
        parent: `O${i}`,
        reversalOf: `O${i}`,
        kind: 'receipt' as const,
        quantities: [['1:P', n]] as [string, number][],
        priority: 0,
      },
    ];
  }).flat();
}

it('w_ck_ck：52单净零历史不能放大可达库存，所需2超过可达1时可靠剪枝', () => {
  const start = performance.now();
  expect(nonnegativeImportOrder(loans(26, true), new Map([['1:P', 1_000_000]]))).toBeNull();
  expect(performance.now() - start).toBeLessThan(1000);
});

it('w_ck_ck：52单正常领用退回链保持可行，所有来源均先于退回', () => {
  const order = nonnegativeImportOrder(loans(26), new Map([['1:P', 1_000_000]]));
  expect(Array.isArray(order)).toBe(true);
  if (!Array.isArray(order)) throw new Error('合法历史被拒绝');
  expect(order).toHaveLength(52);
  for (let i = 0; i < 26; i++) expect(order.indexOf(`O${i}`)).toBeLessThan(order.indexOf(`R${i}`));
});

it('w_ck_ck：更深的不可行周转组合在固定预算内结束，未完成状态不会伪装成可执行顺序', () => {
  const nodes = loans(25);
  for (const key of ['A', 'B'])
    nodes.push(
      { key: `${key}0`, kind: 'issue', quantities: [['1:P', 1_000_000]], priority: 5 },
      {
        key: `${key}1`,
        parent: `${key}0`,
        kind: 'issue',
        quantities: [['1:P', 2_000_000]],
        priority: 1,
      },
      {
        key: `${key}R`,
        parent: `${key}1`,
        reversalOf: `${key}1`,
        kind: 'receipt',
        quantities: [['1:P', 2_000_000]],
        priority: 0,
      },
    );
  const start = performance.now();
  const result = nonnegativeImportOrder(nodes, new Map([['1:P', 3_000_000]]));
  expect(result === null || result === IMPORT_ORDER_INCOMPLETE).toBe(true);
  expect(performance.now() - start).toBeLessThan(1000);
});
