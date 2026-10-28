export type QueryLogic =
  { condition: number } | { op: 'and' | 'or'; left: QueryLogic; right: QueryLogic };

/** Only condition numbers, AND/OR (or Chinese equivalents), and parentheses are accepted. */
export function parseQueryLogic(text: string, count: number): QueryLogic | null {
  if (!text.trim()) return null;
  if (text.length > 500) throw new Error('组合表达式不能超过 500 字');
  const normalized = text
    .replace(/并且/g, ' AND ')
    .replace(/或者/g, ' OR ')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
  const tokens = normalized.match(/\d+|AND|OR|[()]|\S/gi) ?? [];
  if (tokens.length > 150) throw new Error('组合表达式过长');
  let at = 0,
    depth = 0;
  const used = new Set<number>();
  const atom = (): QueryLogic => {
    const token = tokens[at++];
    if (token === '(') {
      if (++depth > 12) throw new Error('括号最多嵌套 12 层');
      const node = or();
      if (tokens[at++] !== ')') throw new Error('括号不匹配');
      depth--;
      return node;
    }
    if (!token || !/^\d+$/.test(token))
      throw new Error('组合表达式只接受条件编号、并且、或者及括号');
    const n = Number(token);
    if (!Number.isSafeInteger(n) || n < 1 || n > count) throw new Error(`条件编号 ${token} 不存在`);
    used.add(n);
    return { condition: n - 1 };
  };
  const and = (): QueryLogic => {
    let n = atom();
    while (tokens[at]?.toUpperCase() === 'AND') {
      at++;
      n = { op: 'and', left: n, right: atom() };
    }
    return n;
  };
  const or = (): QueryLogic => {
    let n = and();
    while (tokens[at]?.toUpperCase() === 'OR') {
      at++;
      n = { op: 'or', left: n, right: and() };
    }
    return n;
  };
  const tree = or();
  if (at !== tokens.length) throw new Error('组合表达式缺少连接词或含多余内容');
  if (used.size !== count) throw new Error('组合表达式必须包含每一条条件，不能静默忽略未引用条件');
  return tree;
}
export function queryLogicText(tree: QueryLogic): string {
  return 'condition' in tree
    ? String(tree.condition + 1)
    : `(${queryLogicText(tree.left)} ${tree.op === 'and' ? '并且' : '或者'} ${queryLogicText(tree.right)})`;
}
