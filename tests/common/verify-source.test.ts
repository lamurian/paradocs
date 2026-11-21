/**
 * Tests for common/verify-source.ts — deterministic source verification.
 *
 * All network access is injected through a mocked fetch, so no test
 * touches the network.
 *
 * @module tests/common/verify-source
 */

import { describe, it, expect, vi } from "vitest";

import { verifySource } from "../../common/verify-source.ts";

import type { VerifySourceDeps } from "../../common/verify-source.ts";

/** Minimal Response-like object accepted by the implementation. */
interface FakeResponse {
  ok: boolean;
  status: number;
  url: string;
  json: () => Promise<unknown>;
}

/**
 * Build a fake fetch response.
 *
 * @param init - Response fields to use.
 * @returns A Response-like object.
 */
function fakeResponse(init: Partial<FakeResponse> = {}): FakeResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: init.url ?? "https://example.org/",
    json: init.json ?? (() => Promise.resolve({})),
  };
}

/**
 * Build deps whose fetch routes by URL prefix.
 *
 * @param routes - Map of URL substring to handler.
 * @returns VerifySourceDeps with a mocked fetch.
 */
function depsFor(routes: Array<[string, () => Promise<FakeResponse>]>): {
  deps: VerifySourceDeps;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [prefix, handler] of routes) {
      if (url.includes(prefix)) return handler();
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  return {
    deps: { fetch: fetchMock as unknown as typeof fetch, now: () => new Date("2025-01-01") },
    fetchMock,
  };
}

describe("verifySource — Crossref DOI", () => {
  it("should return title, container, published date and retraction from Crossref", async () => {
    const { deps, fetchMock } = depsFor([
      [
        "api.crossref.org/works/",
        () =>
          Promise.resolve(
            fakeResponse({
              json: () =>
                Promise.resolve({
                  message: {
                    title: ["A Study of Things"],
                    "container-title": ["Journal of Things"],
                    issued: { "date-parts": [[2021, 4, 9]] },
                    "updated-by": [{ type: "retraction" }, { type: "correction" }],
                  },
                }),
            }),
          ),
      ],
    ]);

    const result = await verifySource({ doi: "10.1234/abc.def" }, deps);

    expect(result.doi).toBe("10.1234/abc.def");
    expect(result.title).toBe("A Study of Things");
    expect(result.container).toBe("Journal of Things");
    expect(result.published).toBe("2021-04-09");
    expect(result.retracted).toBe(true);
    expect(result.checks.crossref).toBe("ok");
    expect(result.trust).toBe("peer-reviewed");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("10.1234/abc.def");
  });

  it("should report retracted false when updated-by has no retraction", async () => {
    const { deps } = depsFor([
      [
        "api.crossref.org/works/",
        () =>
          Promise.resolve(
            fakeResponse({
              json: () =>
                Promise.resolve({
                  message: {
                    title: ["No Retraction"],
                    "container-title": ["Some Journal"],
                    issued: { "date-parts": [[2019]] },
                    "updated-by": [{ type: "correction" }],
                  },
                }),
            }),
          ),
      ],
    ]);

    const result = await verifySource({ doi: "10.1234/plain" }, deps);

    expect(result.retracted).toBe(false);
    expect(result.published).toBe("2019");
  });

  it("should extract the DOI from a URL when no doi is supplied", async () => {
    const { deps, fetchMock } = depsFor([
      [
        "api.crossref.org/works/",
        () =>
          Promise.resolve(
            fakeResponse({
              json: () => Promise.resolve({ message: { title: ["From URL"] } }),
            }),
          ),
      ],
    ]);

    const result = await verifySource({ url: "https://doi.org/10.5555/xyz.1" }, deps);

    expect(result.doi).toBe("10.5555/xyz.1");
    expect(result.title).toBe("From URL");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("10.5555/xyz.1");
  });
});

describe("verifySource — URL reachability and Wayback", () => {
  it("should return reachability, status, canonical URL and closest snapshot", async () => {
    const { deps, fetchMock } = depsFor([
      [
        "example.com/article",
        () =>
          Promise.resolve(
            fakeResponse({
              status: 200,
              url: "https://example.com/article?utm_source=x",
            }),
          ),
      ],
      [
        "archive.org/wayback/available",
        () =>
          Promise.resolve(
            fakeResponse({
              json: () =>
                Promise.resolve({
                  archived_snapshots: {
                    closest: {
                      url: "https://web.archive.org/web/2020/https://example.com/article",
                    },
                  },
                }),
            }),
          ),
      ],
    ]);

    const result = await verifySource({ url: "https://example.com/article" }, deps);

    expect(result.reachable).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.canonicalUrl).toBe("https://example.com/article");
    expect(result.waybackUrl).toBe("https://web.archive.org/web/2020/https://example.com/article");
    expect(result.checks.reachability).toBe("ok");
    expect(result.checks.wayback).toBe("ok");

    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(firstInit.method).toBe("HEAD");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("archive.org/wayback/available?url=");
  });

  it("should retry with GET when HEAD returns 405", async () => {
    let call = 0;
    const { deps } = depsFor([
      [
        "example.com/method",
        () => {
          call += 1;
          return Promise.resolve(
            call === 1
              ? fakeResponse({ status: 405, url: "https://example.com/method" })
              : fakeResponse({ status: 200, url: "https://example.com/method" }),
          );
        },
      ],
      [
        "archive.org/wayback/available",
        () => Promise.resolve(fakeResponse({ json: () => Promise.resolve({}) })),
      ],
    ]);

    const result = await verifySource({ url: "https://example.com/method" }, deps);

    expect(result.httpStatus).toBe(200);
    expect(result.reachable).toBe(true);
    expect(result.waybackUrl).toBeNull();
    expect(result.checks.wayback).toBe("ok");
  });
});

describe("verifySource — failing checks", () => {
  it("should mark each failing check unknown with null fields instead of throwing", async () => {
    const { deps } = depsFor([]);

    const result = await verifySource(
      { url: "https://example.com/down", doi: "10.1234/down" },
      deps,
    );

    expect(result.checks).toEqual({
      reachability: "unknown",
      crossref: "unknown",
      wayback: "unknown",
    });
    expect(result.reachable).toBeNull();
    expect(result.httpStatus).toBeNull();
    expect(result.canonicalUrl).toBeNull();
    expect(result.title).toBeNull();
    expect(result.container).toBeNull();
    expect(result.published).toBeNull();
    expect(result.retracted).toBeNull();
    expect(result.waybackUrl).toBeNull();
    expect(result.doi).toBe("10.1234/down");
  });
});
