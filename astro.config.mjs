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
      filter: (page) => !page.includes('/test') && !page.includes('/e2e') && !page.endsWith('/lock') && !page.endsWith('/unlock'),
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

  redirects: {
    '/lock': {
      status: 301,
      destination: '/lock-file'
    },
    '/unlock': {
      status: 301,
      destination: '/unlock-file'
    },
    '/about/': {
      status: 301,
      destination: '/'
    },
    '/contact/': {
      status: 301,
      destination: '/contact'
    },
    '/docs/': {
      status: 301,
      destination: '/guides'
    },
    '/docs/delivery-methods/': {
      status: 301,
      destination: '/how-it-works'
    },
    '/docs/faq/': {
      status: 301,
      destination: '/faq'
    },
    '/docs/getting-started/': {
      status: 301,
      destination: '/how-it-works'
    },
    '/docs/locking-files/': {
      status: 301,
      destination: '/lock-file'
    },
    '/docs/passwords/': {
      status: 301,
      destination: '/security'
    },
    '/docs/security/': {
      status: 301,
      destination: '/security'
    },
    '/docs/supported-browsers/': {
      status: 301,
      destination: '/faq'
    },
    '/docs/troubleshooting/': {
      status: 301,
      destination: '/faq'
    },
    '/docs/unlocking-files/': {
      status: 301,
      destination: '/unlock-file'
    },
    '/early-access/': {
      status: 301,
      destination: '/'
    },
    '/faq/': {
      status: 301,
      destination: '/faq'
    },
    '/features/': {
      status: 301,
      destination: '/'
    },
    '/how-it-works/': {
      status: 301,
      destination: '/how-it-works'
    },
    '/pricing/': {
      status: 301,
      destination: '/'
    },
    '/privacy/': {
      status: 301,
      destination: '/privacy'
    },
    '/security/': {
      status: 301,
      destination: '/security'
    },
    '/terms/': {
      status: 301,
      destination: '/terms'
    },
    '/who-its-for/': {
      status: 301,
      destination: '/'
    }
  },

  vite: {
    plugins: [tailwindcss()]
  }
});