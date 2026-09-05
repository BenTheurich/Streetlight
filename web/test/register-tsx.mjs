import { readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const imageShim = `data:text/javascript,${encodeURIComponent(`
  import { createElement } from '${import.meta.resolve('react')}';
  export default function Image(properties) { return createElement('img', properties); }
`)}`;

function resolveModule(target) {
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile())
      return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/image') return { shortCircuit: true, url: imageShim };
    if (specifier === 'next/script') {
      return nextResolve(`${specifier}.js`, context);
    }
    if (specifier.startsWith('@/')) {
      const url = resolveModule(path.join(webRoot, specifier.slice(2)));
      if (url) return { shortCircuit: true, url };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      const url = resolveModule(target);
      if (url) return { shortCircuit: true, url };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) {
      const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      return { format: 'module', shortCircuit: true, source: outputText };
    }
    return nextLoad(url, context);
  },
});
