type Movement = {
  key: string;
  parent?: string;
  kind: 'receipt' | 'issue';
  quantities: [string, number][];
  priority: number;
};

/** 快速排序出现短缺时，按来源依赖搜索真实可执行次序；不改动数量或补造库存。 */
export function nonnegativeImportOrder(
  nodes: Movement[],
  initial: Map<string, number>,
): string[] | null {
  const index = new Map(nodes.map((d, i) => [d.key, i]));
  const parents = nodes.map((d) => (d.parent == null ? -1 : (index.get(d.parent) ?? -2)));
  if (parents.includes(-2)) return null;
  const final = new Map([...initial].map(([key, n]) => [key, BigInt(n)]));
  const outgoing = new Set<string>();
  for (const d of nodes)
    for (const [key, n] of d.quantities) {
      final.set(key, (final.get(key) ?? 0n) + (d.kind === 'receipt' ? BigInt(n) : -BigInt(n)));
      if (d.kind === 'issue') outgoing.add(key);
    }
  if ([...outgoing].some((key) => (final.get(key) ?? 0n) < 0n)) return null;
  const receiptAncestors = new Set<number>();
  for (let i = 0; i < nodes.length; i++)
    if (nodes[i]!.kind === 'receipt') {
      const seen = new Set<number>();
      let parent = parents[i]!;
      while (parent >= 0 && !seen.has(parent)) {
        seen.add(parent);
        if (nodes[parent]!.kind === 'issue') receiptAncestors.add(parent);
        parent = parents[parent]!;
      }
    }
  const bits = nodes.map((_, i) => 1n << BigInt(i));
  const all = (1n << BigInt(nodes.length)) - 1n;
  const dead = new Set<bigint>();
  const ready = (i: number, mask: bigint) =>
    !(mask & bits[i]!) && (parents[i]! < 0 || !!(mask & bits[parents[i]!]!));
  const advance = (i: number, stock: Map<string, number>) => {
    const d = nodes[i]!;
    const next = new Map(stock);
    for (const [key, n] of d.quantities) {
      const current = next.get(key) ?? 0;
      if (d.kind === 'issue' && current < n) return null;
      const balance = current + (d.kind === 'receipt' ? n : -n);
      if (!Number.isSafeInteger(balance)) return null;
      next.set(key, balance);
    }
    return next;
  };
  const search = (before: bigint, beforeStock: Map<string, number>): string[] | null => {
    let mask = before,
      stock = beforeStock;
    const prefix: string[] = [];
    // 可执行的入库只增加可用数量，先展开其来源链，避免对普通出库作无效排列。
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < nodes.length; i++)
        if (nodes[i]!.kind === 'receipt' && ready(i, mask)) {
          const next = advance(i, stock);
          if (!next) continue;
          stock = next;
          mask |= bits[i]!;
          prefix.push(nodes[i]!.key);
          changed = true;
        }
    }
    if (mask === all) return prefix;
    if (dead.has(mask)) return null;
    const waitingForReceipts = nodes.some((d, i) => d.kind === 'receipt' && !(mask & bits[i]!));
    const candidates = nodes
      .map((_, i) => i)
      .filter(
        (i) =>
          nodes[i]!.kind === 'issue' &&
          ready(i, mask) &&
          (!waitingForReceipts || receiptAncestors.has(i)),
      )
      .sort((a, b) => nodes[a]!.priority - nodes[b]!.priority);
    for (const i of candidates) {
      const next = advance(i, stock);
      if (!next) continue;
      const suffix = search(mask | bits[i]!, next);
      if (suffix) return [...prefix, nodes[i]!.key, ...suffix];
    }
    dead.add(mask);
    return null;
  };
  return search(0n, new Map(initial));
}
