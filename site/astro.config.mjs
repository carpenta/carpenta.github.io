import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://carpenta.github.io',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
