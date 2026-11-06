import { rest, root } from "./rest";
import { graphql, sdl } from "./graphql";
import openapi from "../../font-corpus/openapi.json";
import { cors, json, problem } from "./http";
import type { Assets } from "./corpus";

/** Return null for unrelated routes; proverb APIs and webhooks remain independent. */
export async function paraRoute(
  request: Request,
  assets: Assets,
): Promise<Response | null> {
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (
    url.hostname === "para.verbacorpus.org" &&
    (path.startsWith("/api/") ||
      path === "/graphql" ||
      path.startsWith("/graphql/"))
  )
    path = "/para" + path;
  const isGraphql = path === "/para/graphql" || path === `${root}/graphql`;
  if (
    !isGraphql &&
    path !== "/para/graphql/schema.graphql" &&
    path !== root &&
    !path.startsWith(root + "/")
  )
    return null;
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  try {
    if (!isGraphql && !["GET", "HEAD"].includes(request.method))
      return json(
        { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or HEAD" } },
        405,
        { allow: "GET, HEAD, OPTIONS" },
      );
    let response: Response;
    if (isGraphql) response = await graphql(request, assets);
    else if (path === "/para/graphql/schema.graphql")
      response = new Response(sdl, {
        headers: { ...cors, "content-type": "text/plain; charset=utf-8" },
      });
    else if (path === `${root}/openapi.json`) response = json(openapi);
    else
      response = await rest(
        request,
        path.slice(root.length).replace(/\/$/, ""),
        assets,
      );
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (error) {
    const response = problem(error);
    return request.method === "HEAD" ? new Response(null, response) : response;
  }
}
