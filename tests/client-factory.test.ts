import { describe, it, expect } from "vitest";
import { adaptClientOptions } from "../src/client-factory.js";

const base = () => ({
  node: "https://es.example:9200",
  maxRetries: 5,
  auth: { username: "elastic", password: "p@ss:w/rd%1" },
  tls: { ca: Buffer.from("ca"), rejectUnauthorized: false },
});

describe("adaptClientOptions", () => {
  it("leaves options untouched for v8+ clients", () => {
    const options = base();
    expect(adaptClientOptions(8, options)).toBe(options);
    expect(adaptClientOptions(9, options)).toBe(options);
  });

  it("leaves options untouched for unknown majors, which load the newest client", () => {
    const options = base();
    expect(adaptClientOptions(10, options)).toBe(options);
    expect(adaptClientOptions(2, options)).toBe(options);
  });

  it.each([5, 6, 7])("moves tls to ssl for the v%i client", (major) => {
    const options = base();
    const adapted = adaptClientOptions(major, options);
    expect(adapted.ssl).toEqual(options.tls);
    expect(adapted).not.toHaveProperty("tls");
    expect(adapted.maxRetries).toBe(5);
  });

  it("does not add ssl when no tls settings were given", () => {
    const { tls, ...options } = base();
    expect(adaptClientOptions(7, options)).not.toHaveProperty("ssl");
  });

  it("keeps the auth object for v6 and v7 clients", () => {
    for (const major of [6, 7]) {
      const adapted = adaptClientOptions(major, base());
      expect(adapted.auth).toEqual({ username: "elastic", password: "p@ss:w/rd%1" });
      expect(adapted.node).toBe("https://es.example:9200");
    }
  });

  it("moves basic auth into the node URL for the v5 client, which decodes it back", () => {
    const adapted = adaptClientOptions(5, base());
    const url = new URL(adapted.node);
    expect(decodeURIComponent(url.username)).toBe("elastic");
    expect(decodeURIComponent(url.password)).toBe("p@ss:w/rd%1");
    expect(url.host).toBe("es.example:9200");
    expect(adapted).not.toHaveProperty("auth");
  });

  it("leaves the v5 node URL alone when there are no basic credentials", () => {
    const { auth, ...options } = base();
    expect(adaptClientOptions(5, options).node).toBe("https://es.example:9200");
    const apiKeyOnly = { ...options, auth: { apiKey: "abc" } };
    expect(adaptClientOptions(5, apiKeyOnly).node).toBe("https://es.example:9200");
  });

  it("does not mutate the options it was given", () => {
    const options = base();
    adaptClientOptions(5, options);
    expect(options.node).toBe("https://es.example:9200");
    expect(options).toHaveProperty("tls");
    expect(options).toHaveProperty("auth");
  });
});
