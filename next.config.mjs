/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  serverExternalPackages: ['pg'],
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
};

export default nextConfig;
