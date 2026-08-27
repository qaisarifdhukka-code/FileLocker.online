// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://filelocker.online',
  integrations: [
    react(), 
    sitemap({
      filter: (page) => !page.includes('/test') && !page.includes('/e2e'),
      serialize(item) {
        if (item.url === 'https://filelocker.online' || item.url === 'https://filelocker.online/') {
          item.url = 'https://filelocker.online/';
        } else if (item.url.endsWith('/')) {
          item.url = item.url.slice(0, -1);
        }
        return item;
      }
    })
  ],

  vite: {
    plugins: [tailwindcss()]
  }
});