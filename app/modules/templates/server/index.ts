import { defineServerModule, moduleKit } from '@caiwu/server-kit';
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

const m = moduleKit(manifest);

export default defineServerModule(manifest, {
  router: m.router({}),
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
  lifecycle: presetLifecycle(supplements.flatMap((entry) => entry.presets ?? [])),
});
