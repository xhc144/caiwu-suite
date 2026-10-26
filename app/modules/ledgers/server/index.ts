import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { ledgersRouter } from './router';

export default defineServerModule(manifest, { router: ledgersRouter, migrations });
