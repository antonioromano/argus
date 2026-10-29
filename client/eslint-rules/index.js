/** Argus-local ESLint plugin. Registered as `argus` in eslint.config.js. */
import noRawStyleScale from './no-raw-style-scale.js';

export default {
  meta: { name: 'eslint-plugin-argus' },
  rules: {
    'no-raw-style-scale': noRawStyleScale,
  },
};
