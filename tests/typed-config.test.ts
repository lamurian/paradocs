import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// parsePort
// ---------------------------------------------------------------------------

describe("parsePort", () => {
  it("should return the default when val is undefined", async () => {
    const { parsePort } = await import("../common/env.js");
    expect(parsePort(undefined, 8888)).toBe(8888);
  });

  it("should parse a valid port string", async () => {
    const { parsePort } = await import("../common/env.js");
    expect(parsePort("9222", 8888)).toBe(9222);
  });

  it("should return default for NaN string", async () => {
    const { parsePort } = await import("../common/env.js");
    expect(parsePort("abc", 8888)).toBe(8888);
  });

  it("should return default for empty string", async () => {
    const { parsePort } = await import("../common/env.js");
    expect(parsePort("", 8888)).toBe(8888);
  });

  it("should clamp values outside valid port range to default", async () => {
    const { parsePort } = await import("../common/env.js");
    expect(parsePort("0", 8888)).toBe(8888);
    expect(parsePort("70000", 8888)).toBe(8888);
    expect(parsePort("-1", 8888)).toBe(8888);
  });
});

// ---------------------------------------------------------------------------
// typed config getters
// ---------------------------------------------------------------------------

describe("getKnowledgeConfig", () => {
  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should return default values when no env vars are set", async () => {
    const { getKnowledgeConfig } = await import("../common/env.js");
    const cfg = getKnowledgeConfig();
    expect(cfg.dir).toBe(
      join(homedir(), "data", "personal", "Documents", "Cognoscere"),
    );
    expect(cfg.db).toBe("notes.db");
  });

  it("should read KNOWLEDGE_DIR from env", async () => {
    process.env.KNOWLEDGE_DIR = "/custom/knowledge";
    const { getKnowledgeConfig } = await import("../common/env.js");
    const cfg = getKnowledgeConfig();
    expect(cfg.dir).toBe("/custom/knowledge");
    expect(cfg.db).toBe("notes.db");
  });

  it("should expand tilde in KNOWLEDGE_DIR", async () => {
    process.env.KNOWLEDGE_DIR = "~/my-knowledge";
    const { getKnowledgeConfig } = await import("../common/env.js");
    const cfg = getKnowledgeConfig();
    expect(cfg.dir).toBe(join(homedir(), "my-knowledge"));
  });

  it("should read KNOWLEDGE_DB from env", async () => {
    process.env.KNOWLEDGE_DB = "my-notes.db";
    const { getKnowledgeConfig } = await import("../common/env.js");
    const cfg = getKnowledgeConfig();
    expect(cfg.dir).toBe(
      join(homedir(), "data", "personal", "Documents", "Cognoscere"),
    );
    expect(cfg.db).toBe("my-notes.db");
  });
});

describe("getSearxngConfig", () => {
  afterEach(() => {
    delete process.env.SEARXNG_PORT;
    delete process.env.SEARXNG_HOST;
    delete process.env.SEARXNG_SECRET_KEY;
    delete process.env.SEARXNG_VERSION;
  });

  it("should return default values when no env vars are set", async () => {
    const { getSearxngConfig } = await import("../common/env.js");
    const cfg = getSearxngConfig();
    expect(cfg.port).toBe(8888);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.secretKey).toBe("thissisanotherthingtodo!");
    expect(cfg.version).toBe("latest");
  });

  it("should read SEARXNG_PORT from env", async () => {
    process.env.SEARXNG_PORT = "9999";
    const { getSearxngConfig } = await import("../common/env.js");
    expect(getSearxngConfig().port).toBe(9999);
  });

  it("should read SEARXNG_HOST from env", async () => {
    process.env.SEARXNG_HOST = "10.0.0.1";
    const { getSearxngConfig } = await import("../common/env.js");
    expect(getSearxngConfig().host).toBe("10.0.0.1");
  });

  it("should read SEARXNG_SECRET_KEY from env", async () => {
    process.env.SEARXNG_SECRET_KEY = "my-secret";
    const { getSearxngConfig } = await import("../common/env.js");
    expect(getSearxngConfig().secretKey).toBe("my-secret");
  });

  it("should read SEARXNG_VERSION from env", async () => {
    process.env.SEARXNG_VERSION = "v1.0";
    const { getSearxngConfig } = await import("../common/env.js");
    expect(getSearxngConfig().version).toBe("v1.0");
  });

  it("should return default port for invalid SEARXNG_PORT", async () => {
    process.env.SEARXNG_PORT = "not-a-number";
    const { getSearxngConfig } = await import("../common/env.js");
    expect(getSearxngConfig().port).toBe(8888);
  });
});

describe("getObscuraConfig", () => {
  afterEach(() => {
    delete process.env.OBSCURA_PORT;
    delete process.env.OBSCURA_HOST;
    delete process.env.OBSCURA_VERSION;
  });

  it("should return default values when no env vars are set", async () => {
    const { getObscuraConfig } = await import("../common/env.js");
    const cfg = getObscuraConfig();
    expect(cfg.port).toBe(9222);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.version).toBe("latest");
  });

  it("should read OBSCURA_PORT from env", async () => {
    process.env.OBSCURA_PORT = "9333";
    const { getObscuraConfig } = await import("../common/env.js");
    expect(getObscuraConfig().port).toBe(9333);
  });

  it("should read OBSCURA_HOST from env", async () => {
    process.env.OBSCURA_HOST = "obscura.local";
    const { getObscuraConfig } = await import("../common/env.js");
    expect(getObscuraConfig().host).toBe("obscura.local");
  });

  it("should read OBSCURA_VERSION from env", async () => {
    process.env.OBSCURA_VERSION = "v2.0";
    const { getObscuraConfig } = await import("../common/env.js");
    expect(getObscuraConfig().version).toBe("v2.0");
  });
});

describe("getApiKeys", () => {
  afterEach(() => {
    delete process.env.TAVILY_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  it("should return empty string defaults when no env vars are set", async () => {
    const { getApiKeys } = await import("../common/env.js");
    const cfg = getApiKeys();
    expect(cfg.tavily).toBe("");
    expect(cfg.github).toBe("");
  });

  it("should read TAVILY_KEY from env", async () => {
    process.env.TAVILY_KEY = "tvly-abc123";
    const { getApiKeys } = await import("../common/env.js");
    expect(getApiKeys().tavily).toBe("tvly-abc123");
  });

  it("should read GITHUB_TOKEN from env", async () => {
    process.env.GITHUB_TOKEN = "ghp_xyz789";
    const { getApiKeys } = await import("../common/env.js");
    expect(getApiKeys().github).toBe("ghp_xyz789");
  });

  it("should return empty string when env var is set to empty", async () => {
    process.env.TAVILY_KEY = "";
    const { getApiKeys } = await import("../common/env.js");
    expect(getApiKeys().tavily).toBe("");
  });
});
