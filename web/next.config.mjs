const googleScriptOrigins = [
  'https://*.googleapis.com',
  'https://*.gstatic.com',
  'https://*.google.com',
  'https://*.ggpht.com',
  'https://*.googleusercontent.com',
];
const googleImageOrigins = [
  'https://*.googleapis.com',
  'https://*.gstatic.com',
  'https://*.google.com',
  'https://*.googleusercontent.com',
];
const googleConnectionOrigins = [
  'https://*.googleapis.com',
  'https://*.gstatic.com',
  'https://*.google.com',
];

export function buildContentSecurityPolicy(development = false) {
  const developmentConnections = development
    ? ['http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*']
    : [];
  const directives = [
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['script-src', "'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', ...googleScriptOrigins],
    ['style-src', "'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    ['img-src', "'self'", 'data:', 'blob:', 'https://tiles.openfreemap.org', ...googleImageOrigins],
    ['font-src', "'self'", 'data:', 'https://fonts.gstatic.com'],
    [
      'connect-src',
      "'self'",
      'data:',
      'blob:',
      'https://tiles.openfreemap.org',
      ...googleConnectionOrigins,
      ...developmentConnections,
    ],
    ['worker-src', "'self'", 'blob:'],
    ['frame-src', 'https://*.google.com'],
  ];
  if (!development) directives.push(['upgrade-insecure-requests']);
  return directives.map((directive) => directive.join(' ')).join('; ');
}

export function buildSecurityHeaders(development = false) {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(development) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['playwright'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(process.env.NODE_ENV !== 'production'),
      },
    ];
  },
};

export default nextConfig;
