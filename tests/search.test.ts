import { describe, expect, it, vi } from "vitest";
import { registerSearch } from "../src/tools/search.js";

function setup(mappingError?: Error, esMajor = 8) {
  let handler: any;
  const server = { tool: (...args: any[]) => { handler = args[args.length - 1]; } };
  const getMapping = mappingError
    ? vi.fn().mockRejectedValue(mappingError)
    : vi.fn().mockResolvedValue({ "test-index": { mappings: { properties: { message: { type: "text" } } } } });
  const search = vi.fn().mockResolvedValue({ hits: { total: { value: 1 }, hits: [{ _source: { message: "found" } }] } });
  registerSearch(server as any, { indices: { getMapping }, search } as any, 100000, undefined, esMajor);
  return { handler, search };
}

const request = { index: "test-index", queryBody: { query: { match_all: {} } }, skip_lint: true, break_token_rule: false };

describe("es_search request and hit preservation", () => {
  it.each([7, 8])("keeps caller timeouts and the default in the ES %i request shape", async (esMajor) => {
    const { handler, search } = setup(undefined, esMajor);
    for (const timeout of [undefined, "5s", "60s", 0]) {
      const queryBody = timeout === undefined ? request.queryBody : { ...request.queryBody, timeout };
      await handler({ ...request, queryBody });
      const sent = search.mock.calls.at(-1)![0];
      const body = esMajor >= 8 ? sent : sent.body;
      expect(body.timeout).toBe(timeout ?? "30s");
      expect(body.query).toEqual(request.queryBody.query);
      expect(sent.index).toBe(request.index);
      expect(queryBody).not.toHaveProperty("highlight");
      if (timeout === undefined) expect(queryBody).not.toHaveProperty("timeout");
    }
  });

  it.each(["fields", "docvalue_fields", "stored_fields", "script_fields"])("returns %s values with _source disabled", async (option) => {
    const { handler, search } = setup();
    const fields = { "user.id": ["user-42"], amount: [12.5, 25], "@timestamp": ["2026-01-01T00:00:00Z"] };
    search.mockResolvedValue({ hits: { total: { value: 1, relation: "eq" }, hits: [{ _index: "orders-000001", _id: "42", fields }] } });
    const selection = option === "script_fields" ? { amount: { script: "1 + 1" } } : Object.keys(fields);
    const result = await handler({ ...request, queryBody: { ...request.queryBody, _source: false, [option]: selection, highlight: { fields: {} } } });
    const output = result.content.map((item: any) => item.text).join("\n");
    expect(output).toContain(`fields: ${JSON.stringify(fields)}`);
    expect(output).toContain('_index: "orders-000001"');
    expect(output).toContain('_id: "42"');
    expect(search.mock.calls[0][0]).toEqual(expect.objectContaining({ _source: false, [option]: selection }));
  });

  it("keeps source values, highlighted excerpts, and returned fields distinct", async () => {
    const { handler, search } = setup();
    search.mockResolvedValue({ hits: { total: { value: 1, relation: "eq" }, hits: [{
      _index: "orders-000001", _id: "42",
      _source: { message: "prefix matched suffix", price: 12.5 },
      highlight: { message: ["<em>matched</em>"] },
      fields: { message: ["prefix matched suffix"], price: ["12.50"], nested: [{ tags: ["a", "b"] }] },
    }] } });
    const result = await handler(request);
    const output = result.content.map((item: any) => item.text).join("\n");
    expect(output).toContain('message: "prefix matched suffix"');
    expect(output).toContain("message (highlighted): <em>matched</em>");
    expect(output).toContain("price: 12.5");
    expect(output).toContain('fields: {"message":["prefix matched suffix"],"price":["12.50"],"nested":[{"tags":["a","b"]}]}');
  });

  it("distinguishes otherwise identical hits by index and document ID", async () => {
    const { handler, search } = setup();
    search.mockResolvedValue({ hits: { total: { value: 2, relation: "eq" }, hits: [
      { _index: "east:orders-000001", _id: "42", _source: { message: "same" } },
      { _index: "west:orders-000001", _id: "84", _source: { message: "same" } },
    ] } });
    const result = await handler(request);
    const hits = result.content.filter((item: any) => item.text.includes('message: "same"'));
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toContain('_index: "east:orders-000001"');
    expect(hits[0].text).toContain('_id: "42"');
    expect(hits[1].text).toContain('_index: "west:orders-000001"');
    expect(hits[1].text).toContain('_id: "84"');
  });
});

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
  it("reports an unknown total when Elasticsearch omits it", async () => {
    const { handler } = remoteSetup({ result: { hits: { hits: [{ _source: { message: "found" } }] } } });
    const result = await handler(request);
    expect(result.content.some((item: any) => item.text.includes("Total results: unknown, showing 1"))).toBe(true);
  });
  it("reports a true zero total", async () => {
    const { handler } = remoteSetup({ result: { hits: { total: { value: 0, relation: "eq" }, hits: [] } } });
    const result = await handler(request);
    expect(result.content.some((item: any) => item.text.includes("Total results: 0, showing 0"))).toBe(true);
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
