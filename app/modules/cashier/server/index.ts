import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { cashierRouter } from './router';
export default defineServerModule(manifest, { router: cashierRouter, migrations });
