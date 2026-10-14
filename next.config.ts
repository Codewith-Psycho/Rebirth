import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint is run explicitly via `npm run lint` so that a lint error never
    // blocks a production build in CI in a confusing way.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    // Keeps server actions payloads predictable for the schedule forms.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
