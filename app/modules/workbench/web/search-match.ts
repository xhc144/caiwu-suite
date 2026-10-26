import { pinyin } from 'pinyin-pro';
export function matchesFunction(term: string, title: string, keywords: string[], group = '') {
  const initials = pinyin(title, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  })
    .join('')
    .replace(/\s+/g, '')
    .toLowerCase();
  return [title, initials, group, ...keywords]
    .join(' ')
    .toLowerCase()
    .includes(term.trim().toLowerCase());
}
