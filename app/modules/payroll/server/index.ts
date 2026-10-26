import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { payrollRouter } from './router';
export default defineServerModule(manifest, { router: payrollRouter, migrations });
