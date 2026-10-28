import { columnName, coordinates } from './shared';

export type ReferenceChange = {
  axis: 'row' | 'col';
  kind: 'insert' | 'delete';
  index: number;
  count: number;
};

type Token = {
  raw: string;
  start: number;
  end: number;
  type: 'word' | 'string' | 'symbol';
  value?: string;
};
type Patch = { start: number; end: number; text: string };

/** 只扫描引用位置，保留空白和取数参数等其余原文，不把字符串当成单元格。 */
function tokens(source: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i]!)) {
      i++;
      continue;
    }
    const start = i;
    const quote = source[i];
    if (quote === '"' || quote === "'") {
      i++;
      let closed = false;
      for (; i < source.length; i++) {
        if (source[i] === '\\') {
          i++;
          continue;
        }
        if (source[i] === quote) {
          i++;
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('公式中的字符串没有结束，请先补全引号再调整行列');
      const raw = source.slice(start, i);
      let value: string | undefined;
      if (quote === '"') {
        try {
          value = JSON.parse(raw) as string;
        } catch {
          // 无效字符串保持原文，由保存时的公式检查说明原因。
        }
      } else value = raw.slice(1, -1).replace(/\\(['\\])/g, '$1');
      out.push({ raw, start, end: i, type: 'string', value });
      continue;
    }
    const word = /^[A-Za-z_0-9]+/.exec(source.slice(i))?.[0];
    if (word) {
      i += word.length;
      out.push({ raw: word, start, end: i, type: /^[A-Za-z_]/.test(word) ? 'word' : 'symbol' });
    } else {
      i++;
      out.push({ raw: source[start]!, start, end: i, type: 'symbol' });
    }
  }
  return out;
}

function address(token: Token | undefined) {
  if (token?.type !== 'word') return null;
  const point = coordinates(token.raw.toUpperCase());
  return point.row ? point : null;
}

function sameCode(a: string, b: string) {
  const clean = (code: string) => (/^\d{1,3}$/.test(code.trim()) ? String(Number(code)) : code);
  return clean(a) === clean(b);
}
export function hasReportReference(source: string, targetCode: string) {
  const list = tokens(source);
  return list.some(
    (token, i) =>
      token.type === 'word' &&
      token.raw.toUpperCase() === 'REF' &&
      list[i + 1]?.raw === '(' &&
      list[i + 2]?.type === 'string' &&
      list[i + 2]?.value !== undefined &&
      sameCode(list[i + 2]!.value!, targetCode),
  );
}

/**
 * 插删本报表行列时移动本地引用和指向本报表的 REF。
 * 删除仍被直接引用的格子会阻止整个操作，让调用方保留原定义。
 */
export function rewriteReferences(
  source: string,
  change: ReferenceChange,
  ownCode: string,
): string {
  return rewrite(source, change, ownCode, true);
}

/** 另一报表的结构变化只影响指向该报表的 REF，不移动本定义内的格和区域。 */
export function rewriteReportReferences(
  source: string,
  change: ReferenceChange,
  targetCode: string,
): string {
  return rewrite(source, change, targetCode, false);
}

function rewrite(
  source: string,
  change: ReferenceChange,
  targetCode: string,
  includeLocal: boolean,
): string {
  if (
    !Number.isSafeInteger(change.index) ||
    !Number.isSafeInteger(change.count) ||
    change.index < 1 ||
    change.count < 1 ||
    !Number.isSafeInteger(change.index + change.count)
  )
    throw new Error('调整行列的位置和数量必须是正整数');
  const { axis, kind, index, count } = change;
  const last = index + count - 1;
  const list = tokens(source);
  const patches: Patch[] = [];
  const label = axis === 'row' ? '行' : '列';
  const single = (n: number, name: string) => {
    if (kind === 'insert') return n >= index ? n + count : n;
    if (n >= index && n <= last)
      throw new Error(`公式直接引用了将删除的单元格 ${name}，请先修改引用再删除${label}`);
    return n > last ? n - count : n;
  };
  const range = (from: number, to: number, name: string) => {
    if (from > to) throw new Error(`公式引用区域 ${name} 的起止顺序不正确，请先修正公式`);
    if (kind === 'insert')
      return [from >= index ? from + count : from, to >= index ? to + count : to] as const;
    if (from >= index && to <= last)
      throw new Error(`公式引用区域 ${name} 将被全部删除，请先修改引用再删除${label}`);
    return [
      from < index ? from : from > last ? from - count : index,
      to < index ? to : to > last ? to - count : index - 1,
    ] as const;
  };
  const changedAddress = (name: string, n: number) => {
    const point = coordinates(name.toUpperCase());
    if (point[axis] === n) return name;
    const next = { ...point, [axis]: n };
    if (next.row > 999 || next.col > 250)
      throw new Error(`调整后单元格 ${name} 的引用超出报表行列上限，请先修改公式`);
    return `${columnName(next.col)}${next.row}`;
  };
  const patch = (token: Token, text: string) => {
    if (text !== token.raw) patches.push({ start: token.start, end: token.end, text });
  };
  for (let i = 0; i < list.length; i++) {
    const current = list[i]!;
    if (current.type !== 'word') continue;
    if (current.raw.toUpperCase() === 'REF' && list[i + 1]?.raw === '(') {
      const code = list[i + 2];
      const target = list[i + 4];
      if (
        code?.type === 'string' &&
        code.value !== undefined &&
        list[i + 3]?.raw === ',' &&
        target?.type === 'string' &&
        target.value !== undefined &&
        list[i + 5]?.raw === ')' &&
        sameCode(code.value, targetCode)
      ) {
        const point = coordinates(target.value.toUpperCase());
        if (point.row) {
          const name = changedAddress(target.value, single(point[axis], target.value));
          if (name !== target.value) {
            const quote = target.raw[0];
            patch(target, `${quote}${name}${quote}`);
          }
        }
      }
    }
    if (!includeLocal) continue;
    const point = address(current);
    if (!point || list[i + 1]?.raw === '(') continue;
    const end = list[i + 2];
    const endPoint = address(end);
    if (list[i + 1]?.raw === ':' && end && endPoint) {
      const [from, to] = range(point[axis], endPoint[axis], `${current.raw}:${end.raw}`);
      patch(current, changedAddress(current.raw, from));
      patch(end, changedAddress(end.raw, to));
      i += 2;
    } else patch(current, changedAddress(current.raw, single(point[axis], current.raw)));
  }
  let result = source;
  for (const p of patches.sort((a, b) => b.start - a.start))
    result = result.slice(0, p.start) + p.text + result.slice(p.end);
  return result;
}
