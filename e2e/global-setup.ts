import { smokeGlobalSetup } from '@smartive/utils/testing/playwright';

export default smokeGlobalSetup({ limits: [{ pattern: '/blog/', max: 2 }] });
