import { describe, expect, it, vi } from "vitest";
import { registerSearch } from "../src/tools/search.js";

function setup(mappingError?: Error) {
  let handler: any;
  const server = { tool: (...args: any[]) => { handler = args[args.length - 1]; } };
  const getMapping = mappingError
    ? vi.fn().mockRejectedValue(mappingError)
    : vi.fn().mockResolvedValue({ "test-index": { mappings: { properties: { message: { type: "text" } } } } });
  const search = vi.fn().mockResolvedValue({ hits: { total: { value: 1 }, hits: [{ _source: { message: "found" } }] } });
  registerSearch(server as any, { indices: { getMapping }, search } as any, 100000);
  return { handler, search };
}

const request = { index: "test-index", queryBody: { query: { match_all: {} } }, skip_lint: true, break_token_rule: false };

describe("es_search mapping lookup", () => {
  it("highlights when mappings are available", async () => {
    const { handler, search } = setup();
    await handler(request);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ highlight: expect.objectContaining({ fields: { message: {} } }) }));
  });
  it("searches without automatic highlighting if cross-cluster mappings are unsupported", async () => {
    const { handler, search } = setup(new Error("Cross-cluster calls are not supported in this context"));
    const result = await handler(request);
    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0][0]).not.toHaveProperty("highlight");
    expect(result.content[0].text).toContain("without automatic highlighting");
    expect(result.content.some((item: any) => item.text.includes("found"))).toBe(true);
  });
  it("does not search after unrelated errors", async () => {
    const { handler, search } = setup(new Error("403 forbidden"));
    const result = await handler(request);
    expect(search).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("403 forbidden");
  });
});

describe("cross-cluster field capabilities and completeness", () => {
  function remoteSetup(options: { caps?: Map<string, any>; capsError?: Error; result?: any; mappingError?: Error } = {}) {
    let handler: any;
    const server = { tool: (...args: any[]) => { handler = args[args.length - 1]; } };
    const getMapping = vi.fn().mockRejectedValue(options.mappingError ?? new Error("Cross-cluster calls are not supported"));
    const search = vi.fn().mockResolvedValue(options.result ?? { hits: { total: { value: 1, relation: "eq" }, hits: [{ _source: { message: "found" } }] } });
    const getFields = options.capsError ? vi.fn().mockRejectedValue(options.capsError) : vi.fn().mockResolvedValue(options.caps ?? new Map());
    registerSearch(server as any, { indices: { getMapping }, search } as any, 100000, { getFields } as any);
    return { handler, search, getFields };
  }
  it("uses remote field capabilities for safe text highlighting", async () => {
    const caps = new Map([
      ["message", { types: ["text"], searchable: true }],
      ["host", { types: ["keyword"], searchable: true }],
      ["conflict", { types: ["text", "keyword"], searchable: true }],
    ]);
    const { handler, search } = remoteSetup({ caps });
    const result = await handler(request);
    expect(search.mock.calls[0][0].highlight.fields).toEqual({ message: {} });
    expect(result.content[0].text).toContain("uses field capabilities");
  });
  it("returns the complete source alongside a highlighted excerpt", async () => {
    const { handler } = remoteSetup({ result: { hits: { total: { value: 1, relation: "eq" }, hits: [{ _source: { message: "prefix matched suffix" }, highlight: { message: ["<em>matched</em>"] } }] } } });
    const result = await handler(request);
    const output = result.content.map((item: any) => item.text).join("\n");
    expect(output).toContain("message (highlighted): <em>matched</em>");
    expect(output).toContain('message: "prefix matched suffix"');
  });
  it("preserves the caller's highlight request", async () => {
    const { handler, search } = remoteSetup();
    const highlight = { fields: { custom: {} } };
    await handler({ ...request, queryBody: { ...request.queryBody, highlight } });
    expect(search.mock.calls[0][0].highlight).toEqual(highlight);
  });
  it("still searches when field capabilities fail", async () => {
    const { handler, search } = remoteSetup({ capsError: new Error("unavailable") });
    const result = await handler(request);
    expect(search).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("without automatic highlighting");
  });
  it("recognizes the Elasticsearch nested error reason", async () => {
    const error = Object.assign(new Error("illegal_argument_exception"), { meta: { body: { error: { reason: "Cross-cluster calls are not supported" } } } });
    const { handler, search } = remoteSetup({ mappingError: error });
    await handler(request);
    expect(search).toHaveBeenCalledOnce();
  });
  it("warns about timeouts, failed shards, skipped clusters and lower-bound totals", async () => {
    const { handler } = remoteSetup({ result: { timed_out: true, _shards: { failed: 2 }, _clusters: { skipped: 1, partial: 1, failed: 0 }, hits: { total: { value: 10, relation: "gte" }, hits: [] } } });
    const result = await handler(request);
    expect(result.content[0].text).toContain("timed out");
    expect(result.content[0].text).toContain("2 shard(s) failed");
    expect(result.content[0].text).toContain("skipped=1, partial=1");
    expect(result.content[0].text).toContain("lower bound");
  });
});
