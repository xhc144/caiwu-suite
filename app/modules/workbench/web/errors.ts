import { getBusinessError } from '@caiwu/web-kit';

/** 仅展示已识别的中文业务提示；连接和协议错误使用可操作的中文说明。 */
export function userError(error: unknown, fallback: string): string {
  const problem = getBusinessError(error);
  return problem && problem.code !== 'UNKNOWN' && /[\u3400-\u9fff]/.test(problem.message)
    ? problem.message
    : fallback;
}
