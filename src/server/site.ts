/** Public origin of the site (APP_URL when set, else derived from the proxy headers). */
export function siteOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) return `${proto ?? new URL(req.url).protocol.replace(':', '')}://${host.split(',')[0].trim()}`;
  return new URL(req.url).origin;
}
