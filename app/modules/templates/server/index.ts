import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import nonprofit from '../templates/nonprofit-2026.json' with { type: 'json' };
import farmer from '../templates/farmer-cooperative-2023.json' with { type: 'json' };
import rural from '../templates/rural-collective-2024.json' with { type: 'json' };
import union from '../templates/trade-union-2022.json' with { type: 'json' };
import grassroots from '../templates/grassroots-trade-union-2022.json' with { type: 'json' };

const m = moduleKit(manifest);

export default defineServerModule(manifest, {
  router: m.router({}),
  templates: [nonprofit, farmer, rural, union, grassroots],
});
