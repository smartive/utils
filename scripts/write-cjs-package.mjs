import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cjsPackagePath = join(rootDir, 'dist', 'cjs', 'package.json');

await mkdir(dirname(cjsPackagePath), { recursive: true });
await writeFile(cjsPackagePath, `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
