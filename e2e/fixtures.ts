import { test as base } from '@playwright/test';
import { smokeFixtures, type SmokeFixtures } from '@smartive/utils/testing/playwright';

export const test = base.extend<SmokeFixtures>(smokeFixtures({ allowHosts: ['127.0.0.1'] }));
export { expect } from '@playwright/test';
