import { describe, expect, it } from "vitest";
import { esErrorMentions, extractMappingProperties, unwrapEsResponse } from "../src/es-response.js";

describe("unwrapEsResponse", () => {
  it("strips the pre-8.x client envelope", () => {
    const envelope = {
      body: { armabear_info_page: { mappings: { properties: {} } } },
      statusCode: 200,
      headers: {},
      warnings: null,
      meta: {},
    };
    expect(unwrapEsResponse(envelope)).toBe(envelope.body);
  });

  it("passes through a v8-style response unchanged", () => {
    const body = { armabear_info_page: { mappings: { properties: {} } } };
    expect(unwrapEsResponse(body)).toBe(body);
  });

  it("passes through non-object and array responses unchanged", () => {
    expect(unwrapEsResponse(null)).toBeNull();
    expect(unwrapEsResponse([{ index: "a" }])).toEqual([{ index: "a" }]);
  });
});

describe("extractMappingProperties", () => {
  it("reads the post-7.0 flat shape", () => {
    const properties = { title: { type: "text" } };
    expect(extractMappingProperties({ properties })).toBe(properties);
  });

  it("reads the pre-7.0 type-nested shape (e.g. _doc)", () => {
    const properties = { title: { type: "text" } };
    expect(extractMappingProperties({ _doc: { properties } })).toBe(properties);
  });

  it("reads a pre-7.0 mapping under a custom (non-_doc) type name", () => {
    const properties = { title: { type: "text" } };
    expect(extractMappingProperties({ page: { properties } })).toBe(properties);
  });

  it("returns an empty object when there is nothing to find", () => {
    expect(extractMappingProperties(undefined)).toEqual({});
    expect(extractMappingProperties({})).toEqual({});
  });
});

describe("esErrorMentions", () => {
  it("matches against error.message", () => {
    expect(esErrorMentions(new Error("contains unrecognized parameter: [expand_wildcards]"), "expand_wildcards")).toBe(true);
    expect(esErrorMentions(new Error("some other failure"), "expand_wildcards")).toBe(false);
  });

  it("matches against the ES REST error body when .message is just the exception name", () => {
    const error = {
      name: "ResponseError",
      message: "illegal_argument_exception",
      meta: {
        body: {
          error: {
            reason: "request [/_cat/indices/*] contains unrecognized parameter: [expand_wildcards]",
          },
        },
      },
    };
    expect(esErrorMentions(error, "expand_wildcards")).toBe(true);
  });

  it("returns false when the needle appears nowhere", () => {
    const error = { message: "illegal_argument_exception", meta: { body: { error: { reason: "unrelated" } } } };
    expect(esErrorMentions(error, "expand_wildcards")).toBe(false);
  });
});
