import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { voucherBookRouter } from './router';
export default defineServerModule(manifest, { router: voucherBookRouter, migrations });
