import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { systemAdminRouter } from './router';

export default defineServerModule(manifest, { router: systemAdminRouter, migrations });
