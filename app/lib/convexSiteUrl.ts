export function getConvexSiteUrl() {
  let convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
  if (!convexSiteUrl) {
    const convexUrl: string | undefined = import.meta.env.VITE_CONVEX_URL as string | undefined;
    if (typeof convexUrl === 'string' && convexUrl.endsWith('.convex.cloud')) {
      convexSiteUrl = convexUrl.replace('.convex.cloud', '.convex.site');
    }
  }
  if (!convexSiteUrl) {
    throw new Error('VITE_CONVEX_SITE_URL is not set and could not infer from VITE_CONVEX_URL');
  }
  return convexSiteUrl;
}
