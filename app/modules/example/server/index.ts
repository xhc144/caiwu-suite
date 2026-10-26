import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { exampleRouter } from './router';

export default defineServerModule(manifest, {
  router: exampleRouter,
  migrations,
  // templates: [ (会计制度模板 JSON) ],
});
