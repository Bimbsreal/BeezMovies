import { allowIndexing, publicConfig } from '../lib/config';

export default function robots() {
  if (!allowIndexing()) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/search', '/account', '/my-list', '/login', '/register', '/forgot-password', '/reset-password', '/admin', '/copyright'],
    },
    sitemap: `${publicConfig.siteUrl}/sitemap.xml`,
  };
}
