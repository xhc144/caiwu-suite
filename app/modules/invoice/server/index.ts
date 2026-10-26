import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { invoiceRouter } from './router';
import { migrations } from './migrations';
export default defineServerModule(manifest, { router: invoiceRouter, migrations });
