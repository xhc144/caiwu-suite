import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import small from '../templates/small-business.json' with { type: 'json' };
import enterprise from '../templates/enterprise.json' with { type: 'json' };
import { booksRouter } from './router';

export default defineServerModule(manifest, {
  router: booksRouter,
  templates: [small, enterprise],
});
