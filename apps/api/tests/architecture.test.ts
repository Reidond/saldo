// Enforces the apps/api layering described in AGENTS.md ("Backend
// architecture"). Every file under src/ is parsed with the TypeScript
// compiler; a violation names the file and the rule it breaks.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const src = fileURLToPath(new URL("../src/", import.meta.url));

type Layer = "http" | "services" | "repositories" | "infrastructure" | "root";

interface Rule {
  /** Layers this layer may import values from. */
  layers: Layer[];
  /** Layers it may import types from (`import type`) in addition. */
  typeLayers?: Layer[];
  /** Packages it may import; a trailing "/" allows subpaths. */
  packages: string[];
}

const rules: Record<Exclude<Layer, "root">, Rule> = {
  // Elysia routes: validate input, call services, map results to HTTP.
  http: {
    layers: ["http", "services"],
    packages: ["elysia", "elysia/", "@saldo/domain"],
  },
  // Business logic; repositories and adapters arrive through constructors.
  services: {
    layers: ["services"],
    typeLayers: ["repositories"],
    packages: ["@saldo/domain", "zod"],
  },
  // SQL only, one statement per function.
  repositories: { layers: ["repositories"], packages: ["@saldo/domain"] },
  // Adapters implementing service ports (Access JWKS, AI bridge, clock).
  infrastructure: {
    layers: ["infrastructure", "services"],
    packages: ["@saldo/domain", "jose"],
  },
};

const sqlText =
  /\b(?:SELECT\b[\s\S]*\bFROM|INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|(?:CREATE|DROP)\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)|ALTER\s+TABLE|PRAGMA\s+\w+)\b/;
/** Files allowed to know about the AI provider. */
const aiAware = [
  "services/chat-service.ts",
  "services/index.ts",
  "services/ports.ts",
];

function layerOf(path: string): Layer {
  const top = relative(src, path).split(sep)[0];
  return top in rules ? (top as Layer) : "root";
}

/** Returns one message per violation; `path` is absolute. */
function violations(path: string, source: string): string[] {
  const file = relative(src, path).split(sep).join("/");
  const layer = layerOf(path);
  const found: string[] = [];
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest);

  const checkImport = (specifier: string, typeOnly: boolean) => {
    if (layer === "root") return;
    const rule = rules[layer];
    if (specifier.startsWith(".")) {
      const target = layerOf(resolve(dirname(path), specifier));
      const allowed =
        rule.layers.includes(target) ||
        (typeOnly && rule.typeLayers?.includes(target));
      if (!allowed)
        found.push(
          `${file}: ${layer} must not import ${typeOnly ? "types from " : ""}${target} (${specifier})`,
        );
    } else if (
      !rule.packages.some((p) =>
        p.endsWith("/") ? specifier.startsWith(p) : specifier === p,
      ) &&
      !(typeOnly && specifier === "zod")
    )
      found.push(`${file}: ${layer} must not import package ${specifier}`);
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        !!clause &&
        (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (!clause.name &&
            !!named &&
            ts.isNamedImports(named) &&
            named.elements.every((e) => e.isTypeOnly)));
      checkImport(node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(node.moduleSpecifier.text, node.isTypeOnly);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      found.push(`${file}: dynamic import is not allowed`);

    if (layer !== "repositories") {
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        sqlText.test(node.text)
      )
        found.push(`${file}: SQL belongs in src/repositories`);
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "prepare"
      )
        found.push(`${file}: only repositories prepare D1 statements`);
    }
    // Bodies are read with readBody (size limit), never Elysia's parser.
    if (
      layer === "http" &&
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.propertyName ?? node.name) &&
      (node.propertyName ?? (node.name as ts.Identifier)).getText(
        sourceFile,
      ) === "body"
    )
      found.push(`${file}: use readBody instead of Elysia's body`);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (
    layer === "services" &&
    !aiAware.includes(file) &&
    /\bAiProvider\b|chat-service/.test(source)
  )
    found.push(`${file}: only the chat service may depend on AI`);
  return found;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}

describe("apps/api layering", () => {
  it("holds for every source file", () => {
    const files = sourceFiles(src);
    expect(files.length).toBeGreaterThan(10);
    expect(
      files.flatMap((path) => violations(path, readFileSync(path, "utf8"))),
    ).toEqual([]);
  });

  it("detects each kind of violation", () => {
    const at = (file: string) => join(src, file);
    expect(
      violations(
        at("http/routes/x.ts"),
        `import { findOwnerUser } from "../../repositories/users";
         import type { Repositories } from "../../repositories";
         import { remoteAccessKeys } from "../../infrastructure/access-verifier";
         import { jwtVerify } from "jose";
         app.post("/x", ({ body }) => body);`,
      ),
    ).toEqual([
      "http/routes/x.ts: http must not import repositories (../../repositories/users)",
      "http/routes/x.ts: http must not import types from repositories (../../repositories)",
      "http/routes/x.ts: http must not import infrastructure (../../infrastructure/access-verifier)",
      "http/routes/x.ts: http must not import package jose",
      "http/routes/x.ts: use readBody instead of Elysia's body",
    ]);
    expect(
      violations(
        at("services/x.ts"),
        `import { listSubscriptionsByAccount } from "../repositories/subscriptions";
         import type { Repositories } from "../repositories";
         import { createApp } from "../http/app";
         const rows = db.prepare("SELECT data FROM subscriptions").all();
         const sql = \`DELETE FROM users WHERE id = \${id}\`;
         let ai: AiProvider;`,
      ),
    ).toEqual([
      "services/x.ts: services must not import repositories (../repositories/subscriptions)",
      "services/x.ts: services must not import http (../http/app)",
      "services/x.ts: only repositories prepare D1 statements",
      "services/x.ts: SQL belongs in src/repositories",
      "services/x.ts: SQL belongs in src/repositories",
      "services/x.ts: only the chat service may depend on AI",
    ]);
    expect(
      violations(
        at("repositories/x.ts"),
        `import { SubscriptionService } from "../services/subscription-service";
         const q = "SELECT id FROM users";`,
      ),
    ).toEqual([
      "repositories/x.ts: repositories must not import services (../services/subscription-service)",
    ]);
    expect(
      violations(
        at("infrastructure/x.ts"),
        `import { json } from "../http/responses";`,
      ),
    ).toEqual([
      "infrastructure/x.ts: infrastructure must not import http (../http/responses)",
    ]);
  });
});
