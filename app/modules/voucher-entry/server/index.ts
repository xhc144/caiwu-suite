import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { entryRouter } from './router';
export default defineServerModule(manifest, { router: entryRouter, migrations });
