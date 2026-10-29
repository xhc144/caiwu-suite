import { defineServerModule } from '@caiwu/server-kit';
import { BusinessError } from '@caiwu/core';
import manifest from '../manifest';
import nonprofit from '../templates/nonprofit-2026.json' with { type: 'json' };
import farmer from '../templates/farmer-cooperative-2023.json' with { type: 'json' };
import rural from '../templates/rural-collective-2024.json' with { type: 'json' };
import union from '../templates/trade-union-2022.json' with { type: 'json' };
import grassroots from '../templates/grassroots-trade-union-2022.json' with { type: 'json' };
import schoolCanteen from '../templates/school-canteen-anhui-2021.json' with { type: 'json' };
import individual from '../templates/individual-business-1997.json' with { type: 'json' };
import { supplements } from './supplement-catalog';
import { presetLifecycle } from './preset-lifecycle';
import { parseSupplementTemplates } from '../preset';
import { templatesRouter } from './router';
import { assertTemplateCreation } from '../creation-policy';
import { TemplateCreationCheckSchema } from '../shared';

const validateCreation = (input: unknown) => {
  const parsed = TemplateCreationCheckSchema.safeParse(input);
  if (!parsed.success)
    throw new BusinessError({
      code: 'TEMPLATE_FACTS_INVALID',
      message: '制度适用条件格式不正确，不能新建账套',
      hint: '请返回启用期间，重新选择准则并逐项确认适用条件',
      details: { issues: parsed.error.issues },
    });
  assertTemplateCreation(parsed.data);
};

export default defineServerModule(manifest, {
  router: templatesRouter,
  validateBookCreation: validateCreation,
  templates: [
    nonprofit,
    farmer,
    rural,
    union,
    grassroots,
    schoolCanteen,
    individual,
    ...parseSupplementTemplates(supplements.flatMap((entry) => entry.templates ?? [])),
  ],
  lifecycle: presetLifecycle(
    supplements.flatMap((entry) => entry.presets ?? []),
    validateCreation,
  ),
});
