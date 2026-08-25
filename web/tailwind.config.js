const shared = require('../tailwind.config.js');

module.exports = {
  // Reuse the Rails design tokens (docuseal DaisyUI theme) verbatim.
  ...shared,
  content: [
    './index.html',
    './builder.html',
    './form.html',
    './src/**/*.{vue,ts}',
    '../server/views/**/*.njk',
  ],
};
