import { withCache } from "./cache.js";
import { handle, type Env } from "./router.js";

// The runtime passes (request, env, ctx). ctx goes only to the cache layer; it must never
// be the third argument of handle, whose optional third parameter is reserved for injected
// adapters in tests (that mix-up once broke production).
export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    return withCache(request, ctx, () => handle(request, env));
  },
};
