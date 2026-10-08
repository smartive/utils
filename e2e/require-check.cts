/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- this file exists to exercise require() */
// Next.js projects are CommonJS, so Playwright compiles their specs to `require()`. Packages in
// node_modules are then loaded by Node itself, which needs a `require` or `default` export
// condition and require(esm). Run with plain `node`, not Playwright, so nothing transpiles it.
const testing = require('@smartive/utils/testing') as typeof import('@smartive/utils/testing');
const playwright = require('@smartive/utils/testing/playwright') as typeof import('@smartive/utils/testing/playwright');

const limited = testing.limitRoutes(['/a/1', '/a/2'], [{ pattern: '/a/', max: 1 }]);

if (limited.join() !== '/a/1' || typeof playwright.smokeFixtures !== 'function') {
  throw new Error(`require() returned unexpected exports: ${JSON.stringify(limited)}`);
}

console.info('require() of @smartive/utils/testing and /testing/playwright works');
