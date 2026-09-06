import { registerHooks } from 'node:module';

// Exercise the retained release UI without changing the site's onboarding default.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url === new URL('../lib/public-site.ts', import.meta.url).href) {
      return {
        ...result,
        source: result.source
          .toString()
          .replace(/PUBLIC_RELEASE_ENABLED = (true|false)/, 'PUBLIC_RELEASE_ENABLED = true'),
      };
    }
    return result;
  },
});
