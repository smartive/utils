import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cleanupDirs = [];
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const runTimeoutMs = 5 * 60 * 1000;

const tarballArgIndex = process.argv.indexOf('--tarball');
const providedTarball = tarballArgIndex === -1 ? null : resolve(process.argv[tarballArgIndex + 1] ?? '');
// --layout-only asserts the built dist/ matches the exports map and nothing else.
// It touches no network, so the release job can sanity-check the artifact it is
// about to publish without depending on registry availability. The install-based
// smokes below need the registry and belong in PR CI.
const layoutOnly = process.argv.includes('--layout-only');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const formatRunFailure = (command, args, cwd, result) => {
  const parts = [`${command} ${args.join(' ')} failed in ${cwd}`];
  if (result.error) {
    parts.push(`spawn error: ${result.error.message}`);
  }
  if (result.signal) {
    parts.push(`signal: ${result.signal}`);
  }
  if (result.status !== null && result.status !== undefined) {
    parts.push(`exit status: ${result.status}`);
  }
  if (result.stdout) {
    parts.push(result.stdout);
  }
  if (result.stderr) {
    parts.push(result.stderr);
  }
  return parts.filter(Boolean).join('\n');
};

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: runTimeoutMs,
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(formatRunFailure(command, args, cwd, result));
  }

  return result.stdout.trim();
};

const runExpectFailure = (command, args, cwd, { label, pattern }) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: runTimeoutMs,
    shell: false,
  });

  assert(result.status !== 0, `${label}: expected failure but command succeeded`);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert(
    pattern.test(output),
    [
      `${label}: output did not match ${pattern}`,
      `exit status: ${result.status}`,
      result.error ? `spawn error: ${result.error.message}` : null,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join('\n'),
  );
};

const assertKeysEqual = (keys, expectedNames, label) => {
  const actual = [...keys].sort();
  const expected = [...expectedNames].sort();
  assert(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label}: expected exports [${expected.join(', ')}] but got [${actual.join(', ')}]`,
  );
};

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const typescriptVersion = packageJson.devDependencies.typescript;
const typesNodeVersion = packageJson.devDependencies['@types/node'];
const datocmsVersion = packageJson.devDependencies['@datocms/cda-client'];
const nextVersion = packageJson.devDependencies.next;
const reactVersion = packageJson.devDependencies.react;
const reactDomVersion = packageJson.devDependencies['react-dom'];

const rootExports = ['classNames', 'getTelLink'];
const httpExports = ['isSafeRelativePath', 'isValidToken', 'withCORS'];
const datocmsExports = ['createDatoClient', 'queryDatoCMS'];
const nextExports = [
  'createDraftHandlers',
  'createRevalidateHandler',
  'createWebPreviewsHandler',
  'makeDraftModeWorkWithinIframes',
];

const assertBuiltLayout = () => {
  for (const entry of ['.', './http', './datocms', './next']) {
    const conditions = packageJson.exports[entry];
    assert(conditions?.import?.default, `exports.${entry}.import.default missing`);
    assert(conditions?.require?.default, `exports.${entry}.require.default missing`);
    assert(conditions?.import?.types, `exports.${entry}.import.types missing`);
    assert(conditions?.require?.types, `exports.${entry}.require.types missing`);
    assert(existsSync(join(rootDir, conditions.import.default)), `missing file ${conditions.import.default}`);
    assert(existsSync(join(rootDir, conditions.require.default)), `missing file ${conditions.require.default}`);
    assert(existsSync(join(rootDir, conditions.import.types)), `missing file ${conditions.import.types}`);
    assert(existsSync(join(rootDir, conditions.require.types)), `missing file ${conditions.require.types}`);
  }

  assert(existsSync(join(rootDir, 'dist/cjs/package.json')), 'missing dist/cjs/package.json marker');
  assert(
    JSON.parse(readFileSync(join(rootDir, 'dist/cjs/package.json'), 'utf8')).type === 'commonjs',
    'cjs package marker must be commonjs',
  );
};

if (layoutOnly) {
  assertBuiltLayout();
  console.log('Built package layout matches the exports map.');
  process.exit(0);
}

const installFixture = ({ name, type, packages }) => {
  const fixtureDir = mkdtempSync(join(tmpdir(), `smartive-utils-${name}-`));
  cleanupDirs.push(fixtureDir);
  writeFileSync(
    join(fixtureDir, 'package.json'),
    `${JSON.stringify({ name: `@smartive/utils-smoke-${name}`, private: true, type }, null, 2)}\n`,
  );
  run(npmCmd, ['install', '--no-package-lock', '--no-fund', '--no-audit', '--prefer-offline', ...packages], fixtureDir);
  return fixtureDir;
};

const writeAndRunKeysScript = (fixtureDir, fileName, specifier, type) => {
  const filePath = join(fixtureDir, fileName);
  if (type === 'module') {
    writeFileSync(filePath, `import * as mod from '${specifier}';\nconsole.log(JSON.stringify(Object.keys(mod).sort()));\n`);
  } else {
    writeFileSync(filePath, `const mod = require('${specifier}');\nconsole.log(JSON.stringify(Object.keys(mod).sort()));\n`);
  }

  return JSON.parse(run('node', [filePath], fixtureDir));
};

const writeTsconfig = (dir, { module, moduleResolution, esModuleInterop = false }) => {
  writeFileSync(
    join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module,
          moduleResolution,
          strict: true,
          noEmit: true,
          // Next's published types pull in incomplete peer graphs; we only assert
          // that our package entry points resolve and type-check for consumers.
          skipLibCheck: true,
          esModuleInterop,
          types: ['node'],
        },
        include: ['./smoke.ts'],
      },
      null,
      2,
    )}\n`,
  );
};

let primaryError = null;

try {
  let tarballPath;

  if (providedTarball) {
    assert(providedTarball && existsSync(providedTarball), `--tarball path not found: ${providedTarball}`);
    const packDir = mkdtempSync(join(tmpdir(), 'smartive-utils-pack-'));
    cleanupDirs.push(packDir);
    tarballPath = join(packDir, 'package.tgz');
    copyFileSync(providedTarball, tarballPath);
  } else {
    assertBuiltLayout();
    const packDir = mkdtempSync(join(tmpdir(), 'smartive-utils-pack-'));
    cleanupDirs.push(packDir);
    const tarballName = run(npmCmd, ['pack', '--silent', '--pack-destination', packDir], rootDir);
    tarballPath = join(packDir, tarballName);
  }

  const sharedPeers = [
    tarballPath,
    `@datocms/cda-client@${datocmsVersion}`,
    `next@${nextVersion}`,
    `react@${reactVersion}`,
    `react-dom@${reactDomVersion}`,
  ];

  const minimalDir = installFixture({
    name: 'minimal',
    type: 'module',
    packages: [tarballPath],
  });

  assertKeysEqual(
    writeAndRunKeysScript(minimalDir, 'smoke-root.mjs', '@smartive/utils', 'module'),
    rootExports,
    'minimal ESM root',
  );
  assertKeysEqual(
    writeAndRunKeysScript(minimalDir, 'smoke-http.mjs', '@smartive/utils/http', 'module'),
    httpExports,
    'minimal ESM http',
  );

  writeFileSync(join(minimalDir, 'smoke-datocms-fail.mjs'), `import '@smartive/utils/datocms';\n`);
  runExpectFailure('node', [join(minimalDir, 'smoke-datocms-fail.mjs')], minimalDir, {
    label: 'datocms without peer',
    pattern: /@datocms\/cda-client/,
  });

  // The /next subpath is bundler-only: it imports bare 'next/headers' etc., and next
  // ships no "exports" map, so Node's ESM loader cannot resolve those (no extension
  // guessing in ESM). Do NOT switch src to 'next/headers.js' to make a raw ESM import
  // work here -- Turbopack does not apply its react-server aliases to the .js form and
  // `next build` then fails with MODULE_UNPARSABLE on app-router-context.
  // Real coverage for this subpath lives in scripts/verify-next-build.mjs.
  const minimalCjsDir = installFixture({
    name: 'minimal-cjs',
    type: 'commonjs',
    packages: [tarballPath],
  });

  writeFileSync(join(minimalCjsDir, 'smoke-next-fail.cjs'), `require('@smartive/utils/next');\n`);
  runExpectFailure('node', [join(minimalCjsDir, 'smoke-next-fail.cjs')], minimalCjsDir, {
    label: 'next without peer',
    pattern: /next\/headers/,
  });

  const peerDir = installFixture({
    name: 'peers',
    type: 'module',
    packages: sharedPeers,
  });

  const cjsDir = installFixture({
    name: 'cjs',
    type: 'commonjs',
    packages: sharedPeers,
  });

  assertKeysEqual(writeAndRunKeysScript(cjsDir, 'smoke-root.cjs', '@smartive/utils', 'commonjs'), rootExports, 'cjs root');
  assertKeysEqual(
    writeAndRunKeysScript(cjsDir, 'smoke-http.cjs', '@smartive/utils/http', 'commonjs'),
    httpExports,
    'cjs http',
  );
  assertKeysEqual(
    writeAndRunKeysScript(cjsDir, 'smoke-datocms.cjs', '@smartive/utils/datocms', 'commonjs'),
    datocmsExports,
    'cjs datocms',
  );
  assertKeysEqual(
    writeAndRunKeysScript(cjsDir, 'smoke-next.cjs', '@smartive/utils/next', 'commonjs'),
    nextExports,
    'cjs next',
  );

  const cjsRequire = createRequire(join(cjsDir, 'package.json'));
  assert(typeof cjsRequire('@smartive/utils/datocms').createDatoClient === 'function', 'createRequire datocms failed');
  assert(typeof cjsRequire('@smartive/utils/next').createDraftHandlers === 'function', 'createRequire next failed');

  assertKeysEqual(writeAndRunKeysScript(peerDir, 'smoke-root.mjs', '@smartive/utils', 'module'), rootExports, 'esm root');
  assertKeysEqual(
    writeAndRunKeysScript(peerDir, 'smoke-http.mjs', '@smartive/utils/http', 'module'),
    httpExports,
    'esm http',
  );
  assertKeysEqual(
    writeAndRunKeysScript(peerDir, 'smoke-datocms.mjs', '@smartive/utils/datocms', 'module'),
    datocmsExports,
    'esm datocms',
  );
  // No raw ESM check for '@smartive/utils/next' -- see the bundler-only note above.
  // scripts/verify-next-build.mjs builds a real Next app on both bundlers instead.

  const typesDir = mkdtempSync(join(tmpdir(), 'smartive-utils-types-'));
  cleanupDirs.push(typesDir);
  mkdirSync(join(typesDir, 'esm'), { recursive: true });
  mkdirSync(join(typesDir, 'cjs'), { recursive: true });
  mkdirSync(join(typesDir, 'node10'), { recursive: true });
  writeFileSync(
    join(typesDir, 'package.json'),
    `${JSON.stringify({ name: '@smartive/utils-smoke-types', private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    npmCmd,
    [
      'install',
      '--no-package-lock',
      '--no-fund',
      '--no-audit',
      '--prefer-offline',
      ...sharedPeers,
      `typescript@${typescriptVersion}`,
      `@types/node@${typesNodeVersion}`,
    ],
    typesDir,
  );

  const smokeSource = `
import { classNames, getTelLink } from '@smartive/utils';
import { isSafeRelativePath, isValidToken, withCORS } from '@smartive/utils/http';
import { createDatoClient, queryDatoCMS } from '@smartive/utils/datocms';
import {
  createDraftHandlers,
  createRevalidateHandler,
  createWebPreviewsHandler,
  makeDraftModeWorkWithinIframes,
} from '@smartive/utils/next';

classNames('a');
getTelLink('+41 44');
isSafeRelativePath('/x');
isValidToken('a', 'a');
withCORS();
createDatoClient({ apiToken: 'token' });
void queryDatoCMS;
createDraftHandlers();
createRevalidateHandler({ paths: ['/'] });
createWebPreviewsHandler({ baseUrl: 'https://example.com', resolvePreviewUrl: async () => null });
void makeDraftModeWorkWithinIframes;
`;

  writeTsconfig(join(typesDir, 'esm'), { module: 'nodenext', moduleResolution: 'nodenext' });
  writeFileSync(join(typesDir, 'esm', 'smoke.ts'), smokeSource);
  writeFileSync(join(typesDir, 'esm', 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

  writeTsconfig(join(typesDir, 'cjs'), {
    module: 'nodenext',
    moduleResolution: 'nodenext',
    esModuleInterop: true,
  });
  writeFileSync(join(typesDir, 'cjs', 'smoke.ts'), smokeSource);
  writeFileSync(join(typesDir, 'cjs', 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

  writeTsconfig(join(typesDir, 'node10'), {
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
  });
  writeFileSync(join(typesDir, 'node10', 'smoke.ts'), smokeSource);
  writeFileSync(join(typesDir, 'node10', 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

  // Child folders resolve packages from the parent install by walking up node_modules.
  const tscJs = join(typesDir, 'node_modules', 'typescript', 'lib', 'tsc.js');
  assert(existsSync(tscJs), 'typescript was not installed in the types fixture');
  for (const folder of ['esm', 'cjs', 'node10']) {
    run('node', [tscJs, '-p', 'tsconfig.json'], join(typesDir, folder));
  }
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) {
      primaryError.message = `${primaryError.message}\nCleanup warnings:\n${cleanupErrors.join('\n')}`;
    }
    throw primaryError;
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Verification passed but cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
}

console.log('Packed package export smoke tests passed.');
