import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { legacyImportRouter } from './router';

export default defineServerModule(manifest, { router: legacyImportRouter, migrations });
