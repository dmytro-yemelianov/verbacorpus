import { handle, type Env } from "./router.js";

// The runtime passes (request, env, ctx); only request and env go to handle,
// whose optional third parameter is reserved for injected adapters in tests.
export default {
  fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    return handle(request, env);
  },
};
