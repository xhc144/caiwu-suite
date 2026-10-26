import { pinyin } from 'pinyin-pro';

/**
 * 拼音首字母（小写），用于科目、辅助项、摘要的模糊搜索。
 * "银行存款" → "yhck"；非汉字原样保留（转小写）。写入名称时调用，结果存到 pinyin 列。
 */
export function pinyinInitials(text: string): string {
  if (!text) return '';
  return pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .replace(/\s+/g, '')
    .toLowerCase();
}
