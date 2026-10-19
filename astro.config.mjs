// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://filelocker.online',
  trailingSlash: 'always',
  integrations: [
    react(), 
    sitemap({
      filter: (page) => !page.includes('/test') && !page.includes('/e2e') && !page.endsWith('/lock') && !page.endsWith('/unlock'),
      serialize(item) {
        if (!item.url.endsWith('/')) {
          item.url = item.url + '/';
        }
        return item;
      }
    })
  ],

  redirects: {
    '/lock': {
      status: 301,
      destination: '/lock-file/'
    },
    '/unlock': {
      status: 301,
      destination: '/unlock-file/'
    },
    '/about/': {
      status: 301,
      destination: '/'
    },
    '/docs/': {
      status: 301,
      destination: '/guides/'
    },
    '/docs/delivery-methods/': {
      status: 301,
      destination: '/how-it-works/'
    },
    '/docs/faq/': {
      status: 301,
      destination: '/faq/'
    },
    '/docs/getting-started/': {
      status: 301,
      destination: '/how-it-works/'
    },
    '/docs/locking-files/': {
      status: 301,
      destination: '/lock-file/'
    },
    '/docs/passwords/': {
      status: 301,
      destination: '/security/'
    },
    '/docs/security/': {
      status: 301,
      destination: '/security/'
    },
    '/docs/supported-browsers/': {
      status: 301,
      destination: '/faq/'
    },
    '/docs/troubleshooting/': {
      status: 301,
      destination: '/faq/'
    },
    '/docs/unlocking-files/': {
      status: 301,
      destination: '/unlock-file/'
    },
    '/early-access/': {
      status: 301,
      destination: '/'
    },
    '/features/': {
      status: 301,
      destination: '/'
    },
    '/pricing/': {
      status: 301,
      destination: '/'
    },
    '/who-its-for/': {
      status: 301,
      destination: '/'
    },
    '/guides/protect-photos/': {
      status: 301,
      destination: '/guides/password-protect-photos/'
    }
  },

  vite: {
    plugins: [tailwindcss()]
  }
});