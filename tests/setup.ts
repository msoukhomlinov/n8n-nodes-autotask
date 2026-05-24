import * as dotenv from 'dotenv';
import * as path from 'path';

// __dirname is available in vitest's CJS compat layer, but fall back to cwd() defensively
const testDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
dotenv.config({ path: path.join(testDir, '.env.test') });
