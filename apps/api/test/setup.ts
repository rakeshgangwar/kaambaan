import { beforeAll } from 'vitest';
import { setupCatalog } from './helpers/catalog';

// The Worker's board routes now touch the D1 catalog (recordBoard/listBoards), so every test file
// needs the catalog tables on its (isolated) test D1.
beforeAll(setupCatalog);
