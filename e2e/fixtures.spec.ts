import { gotoAndSettle } from '@smartive/utils/testing/playwright';

import { expect, test } from './fixtures.js';

const SETTLE = { settleMs: 300 };

test.describe('collects issues', () => {
  test('console errors', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/console-error', SETTLE);

    expect(smoke.issues).toEqual([expect.objectContaining({ type: 'console-error', text: 'client boom' })]);
    smoke.issues.length = 0;
  });

  test('console warnings', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/console-warning', SETTLE);

    expect(smoke.issues).toEqual([expect.objectContaining({ type: 'console-warning', text: 'careful' })]);
    smoke.issues.length = 0;
  });

  test('uncaught exceptions', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/page-error', SETTLE);

    expect(smoke.issues).toEqual([expect.objectContaining({ type: 'pageerror', text: 'uncaught boom' })]);
    smoke.issues.length = 0;
  });

  test('unhandled promise rejections', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/rejection', SETTLE);

    expect(smoke.issues).toEqual([expect.objectContaining({ type: 'pageerror', text: 'unhandled rejection' })]);
    smoke.issues.length = 0;
  });

  test('missing first-party assets, without the duplicate console message', async ({ page, smoke, baseURL }) => {
    await gotoAndSettle(page, '/missing-asset', SETTLE);

    expect(smoke.issues).toEqual([
      { type: 'response', text: `HTTP 404 ${baseURL}/missing.png`, location: `${baseURL}/missing.png` },
    ]);
    smoke.issues.length = 0;
  });

  test('failed first-party requests', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/broken-request', SETTLE);

    expect(smoke.issues).toEqual([expect.objectContaining({ type: 'requestfailed' })]);
    smoke.issues.length = 0;
  });
});

test.describe('stays quiet', () => {
  test('blocks third parties and allows allowlisted hosts', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/third-party', SETTLE);

    expect(await page.evaluate(() => (window as { allowedLoaded?: boolean }).allowedLoaded)).toBe(true);
    expect([...smoke.blockedUrls]).toEqual(['http://tracker.invalid/t.js']);
    expect(smoke.issues).toEqual([]);
  });

  test('ignores aborted requests', async ({ page, smoke }) => {
    await gotoAndSettle(page, '/aborted', SETTLE);

    expect(smoke.issues).toEqual([]);
  });

  test.describe('with ignore rules', () => {
    test.use({ smokeOptions: { ignore: ['client boom'] } });

    test('ignored messages', async ({ page, smoke }) => {
      await gotoAndSettle(page, '/console-error', SETTLE);

      expect(smoke.issues).toEqual([]);
    });
  });

  test.describe('failing only on errors', () => {
    test.use({ smokeOptions: { failOn: ['error'] } });

    test('warnings', async ({ page, smoke }) => {
      await gotoAndSettle(page, '/console-warning', SETTLE);

      expect(smoke.issues).toEqual([]);
    });
  });
});

test('fails the test when issues remain', async ({ page }) => {
  test.fail();

  await gotoAndSettle(page, '/console-error', SETTLE);
});
