import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { bookTemplates } from '../chart';
import { booksRouter } from './router';

export default defineServerModule(manifest, {
  router: booksRouter,
  templates: bookTemplates,
});
