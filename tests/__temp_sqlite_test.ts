import { describe, it, expect } from "vitest";

describe("sqlite-init in vitest", () => {
  it("should work", async () => {
    const { createDb, initDb } = await import("../extensions/para-knowledge/sqlite-init.js");
    const db = createDb(":memory:");
    initDb(db);
    db.exec("INSERT INTO files (path, title) VALUES ('test.md', 'Test')");
    const row = db.prepare("SELECT title FROM files WHERE path = ?").get("test.md") as {
      title: string;
    };
    expect(row.title).toBe("Test");
    db.close();
  });
});
