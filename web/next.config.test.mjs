import assert from 'node:assert/strict';
import test from 'node:test';
import nextConfig, { buildContentSecurityPolicy, buildSecurityHeaders } from './next.config.mjs';

test('production headers cover the map providers and deny embedding', async () => {
  const policy = buildContentSecurityPolicy(false);
  assert.match(policy, /connect-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  assert.match(policy, /script-src[^;]*blob:[^;]*https:\/\/\*\.googleapis\.com/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /workos/);
  assert.doesNotMatch(policy, /localhost|127\.0\.0\.1|ws:/);

  const headers = Object.fromEntries(
    buildSecurityHeaders(false).map(({ key, value }) => [key, value]),
  );
  assert.deepEqual(headers, {
    'Content-Security-Policy': policy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  const configured = await nextConfig.headers();
  assert.equal(configured[0].source, '/:path*');
});

test('development CSP permits local HTTP and sockets without upgrading requests', () => {
  const policy = buildContentSecurityPolicy(true);
  assert.match(policy, /http:\/\/localhost:\*/);
  assert.match(policy, /http:\/\/127\.0\.0\.1:\*/);
  assert.match(policy, /ws:\/\/localhost:\*/);
  assert.match(policy, /ws:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});
