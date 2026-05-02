import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(projectRoot, 'src', 'db', 'migrations');
const dest = join(projectRoot, 'dist', 'db', 'migrations');

cpSync(src, dest, { recursive: true });
