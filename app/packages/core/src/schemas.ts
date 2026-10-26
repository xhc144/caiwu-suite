import { z } from 'zod';
import { isDecimalString } from './decimal';
import { isPeriod, isValidDate } from './period';

/** 常用的 zod 片段。接口入参一律用它们，保证前后端校验一致。 */
export const zId = z.number().int().positive();
export const zCents = z.number().int().refine(Number.isSafeInteger, '金额超出范围');
export const zPeriod = z.number().int().refine(isPeriod, '期间格式应为 yyyymm，例如 202607');
export const zDate = z.string().refine(isValidDate, '日期格式应为 YYYY-MM-DD');
export const zDecimal = z.string().refine(isDecimalString, '应为十进制数字，例如 12.5');
export const zCode = z.string().trim().min(1).max(40);
