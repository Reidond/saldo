import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
describe("D1-compatible schema", () => {
  it("enforces duplicate and account isolation independently of application checks", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_core.sql", "utf8"));
    db.exec("INSERT INTO accounts(id) VALUES ('a'),('b')");
    const insert = db.prepare(
      "INSERT INTO subscriptions(account_id,id,data,duplicate_key) VALUES (?,?,?,?)",
    );
    insert.run("a", "1", "{}", "same|USD");
    expect(() => insert.run("a", "2", "{}", "same|USD")).toThrow();
    insert.run("b", "1", "{}", "same|USD");
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE account_id=?")
        .get("a")?.n,
    ).toBe(1);
    db.close();
  });
  it("rolls back review transaction on one conflicting record", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_core.sql", "utf8"));
    db.exec(
      "INSERT INTO accounts(id) VALUES ('a');INSERT INTO subscriptions(account_id,id,data,duplicate_key) VALUES ('a','one','{}','same|USD')",
    );
    db.exec("BEGIN");
    try {
      db.exec(
        "INSERT INTO reviews(account_id,request_id) VALUES ('a','review');INSERT INTO subscriptions(account_id,id,data,duplicate_key) VALUES ('a','two','{}','new|USD');INSERT INTO subscriptions(account_id,id,data,duplicate_key) VALUES ('a','three','{}','same|USD');COMMIT",
      );
    } catch {
      db.exec("ROLLBACK");
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM subscriptions").get()?.n).toBe(
      1,
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM reviews").get()?.n).toBe(0);
    db.close();
  });
});
