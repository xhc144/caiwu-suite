import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { balancesRouter } from './router';

export default defineServerModule(manifest, { router: balancesRouter, migrations });
