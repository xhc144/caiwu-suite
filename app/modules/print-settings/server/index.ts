import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { printRouter } from './router';
export default defineServerModule(manifest, { router: printRouter, migrations });
