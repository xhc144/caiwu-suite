import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { reportRouter } from './router';

export default defineServerModule(manifest, { router: reportRouter, migrations });
