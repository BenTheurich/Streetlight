import assert from 'node:assert/strict';
import test from 'node:test';
import nextConfig, { buildContentSecurityPolicy, buildSecurityHeaders } from './next.config.mjs';

function directiveSources(policy, name) {
  const directive = policy.split('; ').find((value) => value.startsWith(`${name} `));
  assert(directive);
  return directive.split(' ').slice(1);
}

test('production headers cover the map providers and deny embedding', async () => {
  const policy = buildContentSecurityPolicy(false);
  const scripts = directiveSources(policy, 'script-src');
  const images = directiveSources(policy, 'img-src');
  const connections = directiveSources(policy, 'connect-src');
  assert.match(policy, /connect-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  assert.match(policy, /script-src[^;]*blob:[^;]*https:\/\/\*\.googleapis\.com/);
  assert(scripts.includes('https://*.googleusercontent.com'));
  assert.equal(scripts.includes('https://tiles.openfreemap.org'), false);
  assert(images.includes('https://*.googleusercontent.com'));
  assert(images.includes('https://tiles.openfreemap.org'));
  assert.equal(images.includes('https://*.ggpht.com'), false);
  assert(connections.includes('https://*.googleapis.com'));
  assert(connections.includes('https://tiles.openfreemap.org'));
  assert.equal(connections.includes('https://*.ggpht.com'), false);
  assert.equal(connections.includes('https://*.googleusercontent.com'), false);
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
