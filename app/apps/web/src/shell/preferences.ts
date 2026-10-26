export type Appearance = { theme: 'light' | 'dark' | 'system'; scale: 100 | 125 | 150 };
export const defaultAppearance: Appearance = { theme: 'system', scale: 100 };
export function loadAppearance(key: string): Appearance {
  try {
    const raw = JSON.parse(
      localStorage.getItem(`caiwu.ui.${key}`) ?? 'null',
    ) as Partial<Appearance> | null;
    return {
      theme: raw && ['light', 'dark', 'system'].includes(raw.theme ?? '') ? raw.theme! : 'system',
      scale: raw && [100, 125, 150].includes(raw.scale ?? 0) ? raw.scale! : 100,
    };
  } catch {
    return defaultAppearance;
  }
}
export function saveAppearance(key: string, value: Appearance) {
  try {
    localStorage.setItem(`caiwu.ui.${key}`, JSON.stringify(value));
  } catch {
    /* 内存中仍可使用 */
  }
}
