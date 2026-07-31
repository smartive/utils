import { config } from '@smartive/eslint-config';
import tseslint from 'typescript-eslint';

export default tseslint.config(...config('typescript'), {
  files: ['test/**/*.ts'],
  extends: [tseslint.configs.disableTypeChecked],
  rules: {
    // Tests exercise the compiled package; dist/ is produced by `npm run build` before `npm test`.
    'import/no-unresolved': ['error', { ignore: ['^\\.\\./dist/'] }],
  },
});
