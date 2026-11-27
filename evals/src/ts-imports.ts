// Loaded with `node --import` before the scorer. The scorer reuses theoldman's rules from
// packages/hooks/src, whose relative imports name `.js` files that exist only once esbuild has
// bundled them. Node's type stripping does not map those names to the `.ts` sources, so this
// resolve hook does: a missing relative or file: `x.js` is retried as `x.ts`. Package imports
// are left alone.

import { register } from 'node:module';

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const local = /^(?:\\.\\.?\\/|file:)/.test(specifier);
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !local || !specifier.endsWith('.js')) {
      throw error;
    }
    return next(specifier.slice(0, -3) + '.ts', context);
  }
}
`;

register(`data:text/javascript,${encodeURIComponent(HOOK)}`);
