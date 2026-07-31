import { config } from '@smartive/eslint-config';
import tseslint from 'typescript-eslint';

export default tseslint.config(...config('typescript'), {
  files: ['test/**/*.ts'],
  extends: [tseslint.configs.disableTypeChecked],
});
