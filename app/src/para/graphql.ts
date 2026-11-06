import {
  buildSchema,
  execute,
  parse,
  validate,
  specifiedRules,
  getOperationAST,
  visit,
  Kind,
  GraphQLError,
  type DocumentNode,
  type SelectionSetNode,
  type FragmentDefinitionNode,
} from "graphql";
import {
  catalog,
  filterFacets,
  limits,
  listFonts,
  readFont,
  glyphPage,
  oneGlyph,
  glyphById,
  readBudget,
  type FontHandle,
  CorpusError,
  type Assets,
  type FontFilter,
  type GlyphFilter,
} from "./corpus";
import { json, boundedText } from "./http";

export const sdl = `
  scalar JSON
  type Counts { records: Int!, raster: Int!, metadataOnly: Int!, fixtures: Int!, ukrainianComplete: Int!,glyphs:Int!,unmappedGlyphs:Int! }
  type Manifest { format: String!, schemaVersion: String!, snapshot: String!, counts: Counts!, sources: JSON!, export: JSON! }
  type Cell { width: Int!, height: Int!, monospace: Boolean!, pixelAspectRatio: JSON! }
  type Bitmap { encoding: String!, bitOrder: String!, bitsPerPixel: Int! }
  type UkrainianCoverage { required: Int!, present: Int, missing: [String!], complete: Boolean }
  type Coverage { glyphCount: Int!, unicodeGlyphCount:Int!,unmappedGlyphCount:Int!, ukrainian: UkrainianCoverage! }
  type FontSummary { id: ID!, name: String!, family: String!, kind: String!, availability: String!, cell: Cell!, metrics: JSON!, bitmap: Bitmap!, coverage: Coverage!, licenseId: String!,licenseStatus:String!,collection:String!, sha256: String!, bytes: Int!, url: String! }
  type FontPage { snapshot: String!, total: Int!, limit: Int!, offset: Int!, nextOffset: Int, nodes: [FontSummary!]! }
  type Glyph { id:ID!,codepoint: String, character: String, labels:JSON!,width:Int!,height:Int!,rowBytes:Int!,metrics:JSON!, advanceX: Float!, comment:String, rows: [String!]!, sourceCode: JSON }
  type GlyphPage { fontId: ID!, snapshot: String!, total: Int!, limit: Int!, offset: Int!, nextOffset: Int, missing: [String!]!, nodes: [Glyph!]! }
  type Font { format: String!, schemaVersion: String!, id: ID!, name: String!, family: String!, version: JSON!, kind: String!, availability: String!, cell: Cell!, metrics: JSON!, bitmap: Bitmap!, encodings: JSON!, license: JSON!, source: JSON!, provenance: JSON!, modifications: JSON!, coverage: Coverage!, glyphs(chars: String, limit: Int, offset: Int): GlyphPage, glyph(codepoint: String!): Glyph, glyphById(id:ID!):Glyph }
  type Query {
    manifest: Manifest!
    facets: JSON!
    fonts(q: String, availability: String, ukrainian: String, license: String, collection: String, spacing: String, width: Int, height: Int, sort: String, limit: Int, offset: Int, snapshot: String): FontPage!
    font(id: ID!): Font
  }
`;
const schema = buildSchema(sdl);
function enforceCost(document: DocumentNode, operationName?: string) {
  const operation = getOperationAST(document, operationName);
  if (!operation)
    throw new CorpusError("INVALID_OPERATION", "Choose exactly one operation");
  if (operation.operation !== "query")
    throw new CorpusError("READ_ONLY", "Only queries are supported");
  const fragments = new Map(
    document.definitions
      .filter(
        (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION,
      )
      .map((f) => [f.name.value, f]),
  );
  let count = 0;
  const walk = (set: SelectionSetNode, depth: number): void => {
    if (depth > limits.graphqlDepth)
      throw new CorpusError(
        "QUERY_LIMIT",
        "GraphQL nesting exceeds the supported depth",
      );
    for (const item of set.selections) {
      if (++count > limits.graphqlFields)
        throw new CorpusError(
          "QUERY_LIMIT",
          "GraphQL selection exceeds the supported cost",
        );
      if (item.kind === Kind.FRAGMENT_SPREAD) {
        const fragment = fragments.get(item.name.value);
        if (fragment) walk(fragment.selectionSet, depth + 1);
      } else if (item.selectionSet) walk(item.selectionSet, depth + 1);
    }
  };
  walk(operation.selectionSet, 1);
}
function graphError(error: unknown) {
  if (error instanceof CorpusError)
    return new GraphQLError(error.message, {
      extensions: { code: error.code },
    });
  if (error instanceof GraphQLError) return error;
  return new GraphQLError("Invalid GraphQL request", {
    extensions: { code: "INVALID_REQUEST" },
  });
}
export async function graphql(
  request: Request,
  assets: Assets,
): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!["GET", "POST"].includes(request.method))
    return json({ errors: [{ message: "Use GET or POST" }] }, 405, {
      ...headers,
      allow: "GET, POST, OPTIONS",
    });
  try {
    const url = new URL(request.url);
    let input: unknown;
    if (request.method === "GET") {
      if (new TextEncoder().encode(url.search).length > limits.queryBytes)
        throw new CorpusError("REQUEST_TOO_LARGE", "Query exceeds 32 KiB", 413);
      input = {
        query: url.searchParams.get("query"),
        variables: url.searchParams.has("variables")
          ? JSON.parse(url.searchParams.get("variables")!)
          : undefined,
        operationName: url.searchParams.get("operationName") ?? undefined,
      };
    } else {
      if (
        !(
          request.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() === "application/json"
        )
      )
        throw new CorpusError(
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json",
          415,
        );
      input = JSON.parse(await boundedText(request));
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new CorpusError(
        "INVALID_REQUEST",
        "Expected a GraphQL request object",
      );
    const { query, variables, operationName } = input as {
      query?: unknown;
      variables?: unknown;
      operationName?: unknown;
    };
    if (
      typeof query !== "string" ||
      !query.trim() ||
      (variables !== undefined &&
        variables !== null &&
        (typeof variables !== "object" || Array.isArray(variables))) ||
      (operationName !== undefined && typeof operationName !== "string")
    )
      throw new CorpusError(
        "INVALID_REQUEST",
        "Invalid query, variables or operation name",
      );
    const document = parse(query, { maxTokens: 3000 });
    // Bound raw AST size before validation, which also checks fragment cycles.
    let astNodes = 0;
    visit(document, {
      enter() {
        if (++astNodes > 3000)
          throw new CorpusError("QUERY_LIMIT", "Too many query nodes");
      },
    });
    enforceCost(document, operationName as string | undefined);
    const errors = validate(schema, document, specifiedRules, {
      maxErrors: 20,
    });
    if (errors.length) return json({ errors }, 400, headers);
    let fontLoads = 0,
      glyphsReturned = 0,
      fontSummaries = 0;
    const loaded = new Map<string, Promise<FontHandle>>();
    const nativeBudget = readBudget();
    const getFont = (id: string) => {
      let pending = loaded.get(id);
      if (!pending) {
        if (++fontLoads > limits.graphqlFontLoads)
          throw new CorpusError(
            "QUERY_LIMIT",
            "Too many font records requested",
          );
        pending = readFont(id, assets, nativeBudget);
        loaded.set(id, pending);
      }
      return pending;
    };
    const budget = (count: number) => {
      glyphsReturned += count;
      if (glyphsReturned > limits.graphqlGlyphs)
        throw new CorpusError("QUERY_LIMIT", "Too many glyphs requested");
    };
    const root = {
      manifest: () => catalog,
      facets: () => filterFacets,
      fonts: (args: FontFilter) => {
        const page = listFonts(args);
        fontSummaries += page.nodes.length;
        if (fontSummaries > 200)
          throw new CorpusError(
            "QUERY_LIMIT",
            "Too many font summaries requested",
          );
        return page;
      },
      font: async ({ id }: { id: string }) => {
        const font = await getFont(id);
        return {
          ...font.record,
          glyphs: async (args: GlyphFilter) => {
            const page = await glyphPage(font, args);
            budget(page.nodes.length);
            return page;
          },
          glyph: ({ codepoint }: { codepoint: string }) => {
            budget(1);
            return oneGlyph(font, codepoint);
          },
          glyphById: ({ id }: { id: string }) => {
            budget(1);
            return glyphById(font, id);
          },
        };
      },
    };
    const result = await execute({
      schema,
      document,
      rootValue: root,
      variableValues:
        variables == null ? undefined : (variables as Record<string, unknown>),
      operationName: operationName as string | undefined,
    });
    // Preserve useful public corpus error codes; never expose implementation stacks.
    if (result.errors)
      result.errors = result.errors.map((error) =>
        error.originalError instanceof CorpusError
          ? new GraphQLError(error.message, {
              nodes: error.nodes,
              path: error.path,
              extensions: { code: error.originalError.code },
            })
          : error,
      );
    return json(result, 200, headers);
  } catch (error) {
    return json(
      { errors: [graphError(error)] },
      error instanceof CorpusError ? error.status : 400,
      headers,
    );
  }
}
