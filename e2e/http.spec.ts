import { expect, test } from '@playwright/test';
import { checkUrls } from '@smartive/utils/testing';

test('reports the status of every URL without following redirects', async ({ baseURL }) => {
  const results = await checkUrls(['https://prod.example.com/', '/redirect', '/nope'], { baseURL });

  expect(results.map(({ status, ok }) => ({ status, ok }))).toEqual([
    { status: 200, ok: true },
    { status: 308, ok: false },
    { status: 404, ok: false },
  ]);
});
