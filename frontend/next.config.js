/** @type {import('next').NextConfig} */

const backend = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || '';

if (!backend && process.env.NODE_ENV === 'production') {
  console.warn(
    '\n⚠️  [BANBAN] WARNING: NEXT_PUBLIC_BACKEND_URL is not set!\n' +
    'API calls to /api/* will fail on production.\n'
  );
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Güvenlik ve performans
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
  },

  experimental: {
    scrollRestoration: true,
  },

  // API Rewrites (Backend yönlendirmesi)
  async rewrites() {
    if (!backend) return [];

    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
    ];
  },

  // Güvenlik Header'ları
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
      // Statik dosyalar için uzun cache
      {
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/logos/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

module.exports = nextConfig;
