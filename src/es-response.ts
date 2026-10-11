/**
 * Elasticsearch client generations <8 (the `-v5`/`-v6`/`-v7` packages this
 * server aliases in for older clusters) wrap every response in an envelope
 * `{ body, statusCode, headers, warnings, meta }`. The v8+ client returns
 * the body directly. Tool code built against the v8 shape silently reads
 * `undefined` off the envelope on older clusters instead of throwing, so
 * every call site that reads a client response body must normalize first.
 */
export function unwrapEsResponse<T = any>(response: unknown): T {
  if (
    response !== null &&
    typeof response === "object" &&
    "body" in (response as Record<string, unknown>) &&
    "statusCode" in (response as Record<string, unknown>) &&
    "meta" in (response as Record<string, unknown>)
  ) {
    return (response as { body: T }).body;
  }
  return response as T;
}

/**
 * ES 7.0 removed mapping types, so `GET /{index}/_mapping` responses went
 * from `{ mappings: { <type>: { properties: {...} } } }` (5.x/6.x, where
 * `<type>` is commonly but not always `_doc`) to `{ mappings: { properties:
 * {...} } }`. Extract `properties` regardless of which shape a given
 * cluster returns.
 */
/**
 * ES client errors carry the useful detail in `error.meta.body.error.reason`
 * (the ES REST error body), not in `error.message` — the client's `.message`
 * is often just the bare exception type (e.g. "illegal_argument_exception").
 * Check both when deciding whether to retry with a narrower request.
 */
export function esErrorMentions(error: unknown, needle: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(needle)) return true;
  const reason = (error as any)?.meta?.body?.error?.reason;
  return typeof reason === "string" && reason.includes(needle);
}

export function extractMappingProperties(
  mappings: Record<string, any> | undefined | null
): Record<string, any> {
  if (!mappings) return {};
  if (mappings.properties) return mappings.properties;
  for (const typeKey of Object.keys(mappings)) {
    const typed = mappings[typeKey];
    if (typed?.properties) return typed.properties;
  }
  return {};
}
