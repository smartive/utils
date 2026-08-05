// Builds a real Next.js app against the packed package and asserts that every
// /next export survives a production build on BOTH bundlers.
//
// This exists because Node-level resolution checks (verify-packed-package.mjs)
// cannot catch bundler-specific breakage. Concretely: writing fully-specified
// 'next/headers.js' imports in src resolves fine under Node and webpack, but
// Turbopack does not apply its react-server aliases to the .js form, so a route
// handler pulls the client navigation module and the build dies with
// MODULE_UNPARSABLE on app-router-context. Only a real `next build` catches it.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cleanupDirs = [];
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const runTimeoutMs = 10 * 60 * 1000;

const readFlag = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};

const providedTarball = readFlag('tarball') === null ? null : resolve(readFlag('tarball'));
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const nextVersion = readFlag('next') ?? packageJson.devDependencies.next;
const reactVersion = packageJson.devDependencies.react;
const reactDomVersion = packageJson.devDependencies['react-dom'];
const typescriptVersion = packageJson.devDependencies.typescript;
const typesNodeVersion = packageJson.devDependencies['@types/node'];

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = (command, args, cwd, env) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: runTimeoutMs,
    shell: false,
    env: { ...process.env, ...env },
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed in ${cwd}`,
        result.error ? `spawn error: ${result.error.message}` : null,
        result.signal ? `signal: ${result.signal}` : null,
        `exit status: ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
};

const writeApp = (appDir) => {
  const write = (relativePath, contents) => {
    const target = join(appDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  write('package.json', `${JSON.stringify({ name: 'next-build-smoke', private: true, version: '0.0.0' }, null, 2)}\n`);
  write('next.config.mjs', 'export default {};\n');
  write(
    'tsconfig.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          strict: true,
          noEmit: true,
          module: 'esnext',
          // What real Next apps use, and the resolution mode our published
          // declarations must satisfy.
          moduleResolution: 'bundler',
          jsx: 'preserve',
          skipLibCheck: true,
          esModuleInterop: true,
          isolatedModules: true,
          incremental: true,
          plugins: [{ name: 'next' }],
        },
        include: ['**/*.ts', '**/*.tsx', 'next-env.d.ts'],
      },
      null,
      2,
    )}\n`,
  );

  write(
    'app/layout.tsx',
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  );

  // Server Component: exercises makeDraftModeWorkWithinIframes (next/headers) in
  // the RSC layer, plus the dependency-free root entry point.
  write(
    'app/page.tsx',
    `import { classNames } from '@smartive/utils';
import { makeDraftModeWorkWithinIframes } from '@smartive/utils/next';

export default async function Page() {
  await makeDraftModeWorkWithinIframes();

  return <main className={classNames('a', 'b')}>ok</main>;
}
`,
  );

  // Route handler: exercises next/headers + next/navigation (redirect) + next/server
  // in the server-only app-route layer. This is what the .js specifiers broke.
  write(
    'app/api/draft/route.ts',
    `import { createDraftHandlers } from '@smartive/utils/next';

const handlers = createDraftHandlers({ secret: 'test-secret' });

export const GET = handlers.enable;
export const DELETE = handlers.disable;
`,
  );

  write(
    'app/api/revalidate/route.ts',
    `import { createRevalidateHandler } from '@smartive/utils/next';

export const POST = createRevalidateHandler({ secret: 'test-secret', paths: ['/sitemap.xml'] });
`,
  );

  write(
    'app/api/preview-links/route.ts',
    `import { createWebPreviewsHandler } from '@smartive/utils/next';

const handlers = createWebPreviewsHandler({
  baseUrl: 'https://example.com/api/draft',
  secret: 'test-secret',
  resolvePreviewUrl: async () => '/preview',
});

export const OPTIONS = handlers.OPTIONS;
export const POST = handlers.POST;
`,
  );
};

const expectedRoutes = ['/api/draft', '/api/preview-links', '/api/revalidate'];

let primaryError = null;

try {
  let tarballPath;

  if (providedTarball) {
    assert(existsSync(providedTarball), `--tarball path not found: ${providedTarball}`);
    const packDir = mkdtempSync(join(tmpdir(), 'smartive-utils-next-pack-'));
    cleanupDirs.push(packDir);
    tarballPath = join(packDir, 'package.tgz');
    copyFileSync(providedTarball, tarballPath);
  } else {
    const packDir = mkdtempSync(join(tmpdir(), 'smartive-utils-next-pack-'));
    cleanupDirs.push(packDir);
    const tarballName = run(npmCmd, ['pack', '--silent', '--pack-destination', packDir], rootDir).trim();
    tarballPath = join(packDir, tarballName);
  }

  const appDir = mkdtempSync(join(tmpdir(), 'smartive-utils-next-app-'));
  cleanupDirs.push(appDir);
  writeApp(appDir);

  run(
    npmCmd,
    [
      'install',
      '--no-package-lock',
      '--no-fund',
      '--no-audit',
      '--prefer-offline',
      tarballPath,
      `next@${nextVersion}`,
      `react@${reactVersion}`,
      `react-dom@${reactDomVersion}`,
      `typescript@${typescriptVersion}`,
      `@types/node@${typesNodeVersion}`,
      '@types/react',
      '@types/react-dom',
    ],
    appDir,
  );

  const nextBin = join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  assert(existsSync(nextBin), `next binary not found at ${nextBin}`);

  // Bundler flags differ across the supported peer range: Next 15 defaults to
  // webpack and opts into Turbopack, Next 16 is the reverse. Probe the CLI rather
  // than hardcoding majors so this keeps working as the range moves.
  const buildHelp = run('node', [nextBin, 'build', '--help'], appDir);
  const bundlers = [];

  if (buildHelp.includes('--turbopack')) {
    bundlers.push(['turbopack', ['--turbopack']]);
  } else {
    console.log(`next@${nextVersion}: no --turbopack build flag, skipping the Turbopack build`);
  }

  bundlers.push(buildHelp.includes('--webpack') ? ['webpack', ['--webpack']] : ['webpack (default)', []]);

  assert(bundlers.length === 2, `next@${nextVersion}: expected to cover both bundlers, got ${bundlers.length}`);

  for (const [label, flags] of bundlers) {
    rmSync(join(appDir, '.next'), { recursive: true, force: true });
    const output = run('node', [nextBin, 'build', ...flags], appDir, {
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    });

    for (const route of expectedRoutes) {
      assert(output.includes(route), `next@${nextVersion} ${label}: route ${route} missing from build output:\n${output}`);
    }

    console.log(`next@${nextVersion} build (${label}): ok`);
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

console.log('Next build smoke tests passed.');
