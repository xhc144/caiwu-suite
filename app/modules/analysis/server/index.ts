import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { analysisRouter } from './router';

export default defineServerModule(manifest, { router: analysisRouter, migrations });
