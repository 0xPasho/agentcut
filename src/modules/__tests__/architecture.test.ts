import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The layout in AGENTS.md ("Architecture: domain-driven modules"), checked rather than
 * hoped for. A rule that is only written down is the first thing a hurried change breaks.
 */

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};
const ROOT = path.resolve(import.meta.dirname, "../../..");
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "remotion"))].map(rel);
const parse = (file: string) =>
  ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Every import and dynamic import in a file, with whether it survives compilation. */
function imports(file: string) {
  const found: Array<{ spec: string; typeOnly: boolean }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!named && named.length > 0 && named.every((el) => el.isTypeOnly)));
      found.push({ spec: node.moduleSpecifier.text, typeOnly });
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      found.push({ spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      found.push({ spec: node.arguments[0].text, typeOnly: false });
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

const resolveSpec = (from: string, spec: string) => {
  if (spec.startsWith("@/")) return "src/" + spec.slice(2);
  if (spec.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return null;
};

const inServer = (file: string) => /(^|\/)server\//.test(file);
const isTest = (file: string) => file.includes("/__tests__/");

test("everything lives in a module or in common: no src/lib, no src/components", () => {
  const stray = files.filter((file) => file.startsWith("src/lib/") || file.startsWith("src/components/"));
  assert.deepEqual(stray, []);
  for (const file of files.filter((f) => f.startsWith("src/"))) {
    assert.ok(/^src\/(app|common|modules|types)\//.test(file), `${file} is outside app, common and modules`);
  }
});

test("node-only code is only reached from server code, routes, scripts and tests", () => {
  const bad: string[] = [];
  for (const file of files) {
    if (inServer(file) || isTest(file) || file.startsWith("src/app/")) continue;
    for (const { spec, typeOnly } of imports(file)) {
      if (typeOnly) continue;
      const target = resolveSpec(file, spec);
      if (target && inServer(target)) bad.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, [], "a browser or Remotion file imports server code at runtime");
});

test("components, views and hooks declare no types but their props", () => {
  const bad: string[] = [];
  const hooks = (f: string) => /^src\/(modules|common)\/.*(\/hooks\/|\/hooks\.ts$)/.test(f);
  for (const file of files.filter((f) => (/^src\/modules\/.*\.tsx$/.test(f) || hooks(f)) && !isTest(f))) {
    for (const statement of parse(file).statements) {
      if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue;
      if (/Props$/.test(statement.name.text)) continue;
      bad.push(`${file}: ${statement.name.text}`);
    }
  }
  assert.deepEqual(bad, [], "move these to the module's types.ts");
});

test("pages only load and render: no database, no server plumbing", () => {
  const bad: string[] = [];
  for (const file of files.filter((f) => /^src\/app\/.*page\.tsx$/.test(f))) {
    for (const { spec } of imports(file)) {
      if (/common\/server\//.test(spec) || /\/server\/(store|db|jobs|reaper)$/.test(spec)) bad.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
