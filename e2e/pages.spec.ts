import { gotoAndSettle, readRoutes } from '@smartive/utils/testing/playwright';

import { expect, test } from './fixtures.js';

const routes = readRoutes();

test('global setup wrote the limited sitemap routes', () => {
  expect(routes).toEqual(['/', '/blog/a', '/blog/b', '/de', '/fr']);
});

for (const route of routes) {
  test(`sitemap route ${route}`, async ({ page }) => {
    const response = await gotoAndSettle(page, route, { settleMs: 200 });

    expect(response?.status()).toBe(200);
  });
}
