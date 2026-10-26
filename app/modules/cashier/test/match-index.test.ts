import { expect, it } from 'vitest';
import { matchSuggestions } from '../shared';

it('w_cn_dz 20k唯一金额按索引完整匹配，读键次数随输入线性增长', () => {
  let reads = 0;
  const n = 20000;
  const documents = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    date: '2026-01-10',
    matchId: null,
    get signed() {
      if (++reads > 8 * n) throw new Error('候选读取超过线性索引预算');
      return i + 1;
    },
  }));
  const entries = Array.from({ length: n }, (_, i) => ({
    lineId: i + 1,
    date: '2026-01-10',
    matchId: null,
    get signed() {
      if (++reads > 8 * n) throw new Error('候选读取超过线性索引预算');
      return i + 1;
    },
  }));
  const result = matchSuggestions(documents, entries);
  expect(result).toHaveLength(n);
  expect(
    result.every(
      (s) => s.unique && s.candidates.length === 1 && s.candidates[0]!.lineId === s.document.id,
    ),
  ).toBe(true);
  // 直接约束索引访问；旧实现会读取约 D×E + D² 次，不依赖机器运行速度。
  expect(reads).toBeLessThanOrEqual(8 * n);
});
it('w_cn_dz 10k重复金额共享一个有序候选桶，不保留一亿候选引用', () => {
  const documents = Array.from({ length: 10000 }, (_, i) => ({
    id: i + 1,
    date: '2026-01-10',
    signed: 101,
    matchId: null,
  }));
  const entries = Array.from({ length: 10000 }, (_, i) => ({
    lineId: 10000 - i,
    date: i % 2 ? '2026-01-10' : '2026-01-11',
    signed: 101,
    matchId: null,
  }));
  const result = matchSuggestions(documents, entries);
  expect(result).toHaveLength(10000);
  expect(result.every((s) => !s.unique && s.candidates === result[0]!.candidates)).toBe(true);
  expect(new Set(result[0]!.candidates.map((e) => e.lineId)).size).toBe(10000);
  expect(result[0]!.candidates[0]).toMatchObject({ date: '2026-01-10', lineId: 1 });
  expect(result[0]!.candidates.at(-1)).toMatchObject({ date: '2026-01-11', lineId: 10000 });
});
it('w_cn_dz 分桶保留方向、日期顺序、已勾排除和双方唯一语义', () => {
  const result = matchSuggestions(
    [
      { id: 3, date: '2026-01-11', signed: 101, matchId: null },
      { id: 2, date: '2026-01-10', signed: -101, matchId: null },
      { id: 1, date: '2026-01-10', signed: 101, matchId: 1 },
      { id: 4, date: '2026-01-11', signed: 999, matchId: null },
    ],
    [
      { lineId: 3, date: '2026-01-11', signed: 101, matchId: 1 },
      { lineId: 2, date: '2026-01-10', signed: -101, matchId: null },
      { lineId: 1, date: '2026-01-10', signed: 101, matchId: null },
    ],
  );
  expect(result.map((s) => [s.document.id, s.unique, s.candidates.map((e) => e.lineId)])).toEqual([
    [2, true, [2]],
    [3, true, [1]],
    [4, false, []],
  ]);
});
