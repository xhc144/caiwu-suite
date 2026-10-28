import type { TemplatePresetInput, TemplateSupplement } from '../../preset';
import { constructionPresets } from './presets';

/**
 * 统一registry owner的唯一接入口。只交付差量；基表由owner已注册的制度取得。
 * 2003历史包缺法定基表，不混入可注册presets，也不把阻塞项伪装成单独制度。
 */
export const supplement: TemplateSupplement = {
  presets: constructionPresets
    .filter((preset) => preset.integration === 'ready')
    .map((preset): TemplatePresetInput => ({
      id: preset.id,
      version: preset.version,
      name: preset.name,
      description: preset.description,
      baseTemplateId: preset.baseTemplateId,
      baseTemplateVersion: preset.baseVersion,
      order: preset.id === 'construction-cas-revenue-2017' ? 20 : 21,
      additionalAccounts: [...preset.additions],
      accountOverrides: [
        ...preset.overrides.map(({ code, source, ...changes }) => {
          if (!source?.trim()) throw new Error(`施工科目 ${code} 缺少覆盖依据`);
          // changes只含实际给出的字段；不为省略的dimensions补[]。
          return { code, source, ...changes };
        }),
        // 指定版本基表的两个旧模型科目均无预置下级；不触碰任何其他科目。
        ...preset.disableSubtrees.map((code) => ({
          code,
          disabled: true,
          source:
            '财会〔2017〕22号通知第一项：执行新收入准则后不再执行原建造合同准则；本施工预设停用旧工程施工/工程结算，使用合同履约成本及合同结算，不修改已有账套。',
        })),
      ],
      sources: [...preset.sources],
    })),
};
