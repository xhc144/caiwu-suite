/** 编号只分配、不解释公式；恢复的坏稿中已有引用也保留其编号，防止自动改指新项目。 */
export function nextDefinitionProjectKey(
  rows: readonly { key: number; formula: string }[],
  previousNext = 1,
): number {
  let maximum = Math.max(0, previousNext - 1);
  for (const row of rows) {
    maximum = Math.max(maximum, row.key);
    for (const match of row.formula.matchAll(/项目\s*\(\s*(\d+)/g)) {
      const reference = Number(match[1]);
      maximum = Math.max(
        maximum,
        Number.isSafeInteger(reference) ? Math.min(reference, 9999) : 9999,
      );
    }
  }
  return maximum + 1;
}
