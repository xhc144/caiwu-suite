import type { TemplateSupplement } from '../preset';
import { supplement as construction } from '../supplements/construction/supplement';
import { supplement as pawn } from '../supplements/pawn';
import { supplement as partyDues } from '../supplements/party-dues';
import { supplement as realEstate } from '../supplements/real-estate';
import { supplement as guarantee } from '../supplements/guarantee';
import { supplement as infrastructure } from '../supplements/infrastructure';

/** 地方党费保持deprecated；历史基建缺统一年份拦截，政府双体系子集不登记。 */
export const supplements: readonly TemplateSupplement[] = [
  construction,
  pawn,
  realEstate,
  guarantee,
  partyDues,
  { presets: infrastructure.presets },
];
