import { rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = resolve(__dirname, '../../api/data/e2e');

try {
  rmSync(dbDir, { recursive: true, force: true });
} catch (err) {
  console.error('warn: failed to clean e2e db dir:', err.message);
}
mkdirSync(dbDir, { recursive: true });
console.log('e2e db dir cleaned at', dbDir);
