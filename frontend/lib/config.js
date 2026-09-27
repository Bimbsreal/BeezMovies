export const publicConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  siteEnv: process.env.NEXT_PUBLIC_SITE_ENV || 'development',
};

export function allowIndexing(siteEnv = publicConfig.siteEnv) {
  return siteEnv !== 'staging';
}
