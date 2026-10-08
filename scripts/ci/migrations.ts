import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

// This deliberately recognizes a small SQLite subset, not arbitrary SQL. New
// migration syntax needs explicit review and tests before widening this policy.
const forbidden = new Set([
  "DROP",
  "DELETE",
  "UPDATE",
  "TRUNCATE",
  "REPLACE",
  "INSERT",
  "SELECT",
  "ATTACH",
  "DETACH",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "TRIGGER",
  "VIRTUAL",
]);
const types = new Set(["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC"]);
type Token = {
  kind: "word" | "string" | "identifier" | "number" | "symbol";
  value: string;
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unknown migration validation error.";

function tokenize(source: string): Token[] {
  if (
    typeof source !== "string" ||
    source.length > 1_000_000 ||
    source.includes("\0")
  )
    throw new Error("Migration must be NUL-free SQL text no larger than 1 MB.");
  const sql = source.replace(/^\uFEFF/, "");
  const tokens: Token[] = [];
  for (let i = 0; i < sql.length;) {
    if (/[ \t\r\n\f]/.test(sql[i])) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1 || sql.slice(i + 2, end).includes("/*"))
        throw new Error("Unterminated or nested SQL comment.");
      i = end + 2;
      continue;
    }
    const quote = sql[i];
    if (["'", '"', "`", "["].includes(quote)) {
      const closing = quote === "[" ? "]" : quote;
      let value = "",
        ended = false;
      i++;
      while (i < sql.length) {
        if (sql[i] === closing) {
          if (quote !== "[" && sql[i + 1] === closing) {
            value += closing;
            i += 2;
            continue;
          }
          i++;
          ended = true;
          break;
        }
        value += sql[i++];
      }
      if (!ended) throw new Error("Unterminated SQL string or identifier.");
      tokens.push({ kind: quote === "'" ? "string" : "identifier", value });
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (word) {
      const value = word[0].toUpperCase();
      if (forbidden.has(value))
        throw new Error(`Disallowed SQL keyword: ${value}.`);
      tokens.push({ kind: "word", value });
      i += word[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      sql.slice(i),
    );
    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      i += number[0].length;
      continue;
    }
    const symbol = /^(?:<=|>=|<>|!=|[(),;=<>+-])/.exec(sql.slice(i));
    if (!symbol) throw new Error(`Unsupported SQL character at offset ${i}.`);
    tokens.push({ kind: "symbol", value: symbol[0] });
    i += symbol[0].length;
  }
  return tokens;
}

class AdditiveParser {
  tokens: Token[];
  position: number;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.position = 0;
  }
  at(value: string): boolean {
    const token = this.tokens[this.position];
    return (
      !!token &&
      ["word", "symbol"].includes(token.kind) &&
      token.value === value
    );
  }
  take(value: string) {
    if (!this.at(value)) return false;
    this.position++;
    return true;
  }
  require(value: string) {
    if (!this.take(value))
      throw new Error(`Expected ${value} in supported additive SQL.`);
  }
  identifier() {
    const token = this.tokens[this.position++];
    if (!token || !["word", "identifier"].includes(token.kind) || !token.value)
      throw new Error("Expected a nonempty SQL identifier.");
    // SQLite's reserved catalog is never an application migration target.
    if (/^sqlite_/i.test(token.value))
      throw new Error("SQLite internal identifiers are forbidden.");
  }
  identifiers() {
    this.require("(");
    do {
      this.identifier();
    } while (this.take(","));
    this.require(")");
  }
  literal(allowTimestamp = false) {
    if (this.take("+") || this.take("-")) {
      if (this.tokens[this.position]?.kind !== "number")
        throw new Error("A signed default must be a number.");
    }
    const token = this.tokens[this.position];
    if (token && ["number", "string"].includes(token.kind)) {
      this.position++;
      return true;
    }
    if (this.take("NULL")) return false;
    if (this.take("TRUE") || this.take("FALSE")) return true;
    if (allowTimestamp && this.take("CURRENT_TIMESTAMP")) return true;
    throw new Error(
      "Only literal defaults are allowed (CURRENT_TIMESTAMP only on new tables).",
    );
  }
  reference() {
    this.identifier();
    this.identifiers();
  }
  check(depth = 0) {
    if (depth > 32)
      throw new Error("CHECK expression nesting exceeds the safety limit.");
    this.checkAtom(depth);
    while (
      ["AND", "OR", "=", "!=", "<>", "<", ">", "<=", ">="].some((v) =>
        this.at(v),
      )
    ) {
      this.position++;
      this.checkAtom(depth);
    }
    if (this.take("IS")) {
      this.take("NOT");
      this.require("NULL");
    }
  }
  checkAtom(depth: number): void {
    if (depth > 32)
      throw new Error("CHECK expression nesting exceeds the safety limit.");
    if (this.take("NOT")) {
      this.checkAtom(depth + 1);
      return;
    }
    if (this.take("(")) {
      this.check(depth + 1);
      this.require(")");
      return;
    }
    const token = this.tokens[this.position];
    if (!token) throw new Error("Incomplete CHECK expression.");
    if (
      ["string", "number"].includes(token.kind) ||
      ["NULL", "TRUE", "FALSE", "+", "-"].some((v) => this.at(v))
    ) {
      this.literal();
      return;
    }
    // The existing schema uses json_valid. Arbitrary functions, subqueries,
    // collations, extension loading and generated expressions are not allowed.
    if (this.take("JSON_VALID")) {
      this.require("(");
      this.identifier();
      this.require(")");
      return;
    }
    this.identifier();
  }
  column(alter = false) {
    this.identifier();
    const type = this.tokens[this.position++];
    if (!type || type.kind !== "word" || !types.has(type.value))
      throw new Error(
        "Only TEXT, INTEGER, REAL, BLOB and NUMERIC columns are supported.",
      );
    const seen = new Set<string>();
    let notNull = false,
      nonNullDefault = false;
    while (
      this.position < this.tokens.length &&
      !this.at(",") &&
      !this.at(")") &&
      !this.at(";")
    ) {
      const modifier = this.tokens[this.position]?.value;
      if (seen.has(modifier)) throw new Error("Repeated column constraint.");
      seen.add(modifier);
      if (this.take("NOT")) {
        this.require("NULL");
        notNull = true;
      } else if (this.take("DEFAULT")) nonNullDefault = this.literal(!alter);
      else if (!alter && this.take("PRIMARY")) {
        this.require("KEY");
      } else if (!alter && this.take("UNIQUE")) {
        /* Additive new-table uniqueness. */
      } else if (!alter && this.take("REFERENCES")) this.reference();
      else if (!alter && this.take("CHECK")) {
        this.require("(");
        this.check();
        this.require(")");
      } else
        throw new Error(
          "Unsupported column constraint; migration needs explicit review.",
        );
    }
    if (alter && notNull && !nonNullDefault)
      throw new Error(
        "ADD COLUMN NOT NULL requires a non-NULL literal DEFAULT.",
      );
  }
  tableEntry() {
    if (this.take("PRIMARY")) {
      this.require("KEY");
      this.identifiers();
    } else if (this.take("UNIQUE")) this.identifiers();
    else if (this.take("FOREIGN")) {
      this.require("KEY");
      this.identifiers();
      this.require("REFERENCES");
      this.reference();
    } else if (this.take("CHECK")) {
      this.require("(");
      this.check();
      this.require(")");
    } else this.column();
  }
  statement() {
    if (this.take("PRAGMA")) {
      this.require("FOREIGN_KEYS");
      this.require("=");
      this.require("ON");
    } else if (this.take("CREATE")) {
      if (this.take("TABLE")) {
        this.require("IF");
        this.require("NOT");
        this.require("EXISTS");
        this.identifier();
        this.require("(");
        do {
          this.tableEntry();
        } while (this.take(","));
        this.require(")");
      } else {
        this.take("UNIQUE");
        this.require("INDEX");
        if (this.take("IF")) {
          this.require("NOT");
          this.require("EXISTS");
        }
        this.identifier();
        this.require("ON");
        this.identifier();
        this.require("(");
        do {
          this.identifier();
          if (!this.take("ASC")) this.take("DESC");
        } while (this.take(","));
        this.require(")");
      }
    } else if (this.take("ALTER")) {
      this.require("TABLE");
      this.identifier();
      this.require("ADD");
      this.require("COLUMN");
      this.column(true);
    } else
      throw new Error(
        "Only additive CREATE TABLE/INDEX, ALTER TABLE ADD COLUMN, and foreign_keys=ON are allowed.",
      );
    if (this.position < this.tokens.length) this.require(";");
  }
}

/** Pure, fail-closed source validation. Throws for unsupported or unsafe SQL. */
export function validateMigration(source: string) {
  const parser = new AdditiveParser(tokenize(source));
  let statementCount = 0;
  while (parser.position < parser.tokens.length) {
    try {
      parser.statement();
    } catch (error) {
      throw new Error(
        `Statement ${statementCount + 1}: ${errorMessage(error)}`,
      );
    }
    statementCount++;
  }
  if (!statementCount)
    throw new Error("Migration has no supported SQL statements.");
  return { statementCount };
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error(
      "Usage: node scripts/ci/migrations.ts (checks every repository migration).",
    );
  const directory = resolve(
    fileURLToPath(new URL("../../apps/api/migrations/", import.meta.url)),
  );
  if (!(await lstat(directory)).isDirectory())
    throw new Error(
      "The migrations path must be a regular directory, not a symbolic link.",
    );
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  if (!entries.length)
    throw new Error("No migrations found; refusing an empty migration check.");
  let statementCount = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{4,}_[A-Za-z0-9_-]+\.sql$/.test(entry.name))
      throw new Error(
        `Unexpected migration entry: ${entry.name}. Only numbered regular .sql files are allowed.`,
      );
    try {
      statementCount += validateMigration(
        await readFile(resolve(directory, entry.name), "utf8"),
      ).statementCount;
    } catch (error) {
      throw new Error(`${entry.name}: ${errorMessage(error)}`);
    }
  }
  console.log(
    `Validated ${entries.length} additive migration(s), ${statementCount} statement(s). No database was contacted.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
