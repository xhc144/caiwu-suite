import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { importRouter } from './router';

export default defineServerModule(manifest, { router: importRouter, migrations });
