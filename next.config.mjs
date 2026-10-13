import { execSync } from 'node:child_process';

/** Short commit id of this build (Railway provides it; locally read from git). */
function buildId() {
  const env = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || process.env.GIT_COMMIT;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  poweredByHeader: false,
  transpilePackages: ['three'],
  serverExternalPackages: ['pg'],
  // Marketing images are pre-sized at build time; no runtime optimizer needed.
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/marketing/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
    ];
  },
};

export default nextConfig;
