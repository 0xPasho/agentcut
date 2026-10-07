import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The layout in AGENTS.md ("Architecture"), checked rather than hoped for. A rule that is
 * only written down is the first thing a hurried change breaks.
 *
 * Paths below are relative to the repository root:
 *   apps/studio/src     the visual editor (Next.js): routes, views, components, hooks
 *   packages/core/src   the editor without a face: model, operations, server code
 *   packages/render/src the Remotion compositions
 *   packages/cli/src    the `agentcut` command
 */

const walk = (dir: string, out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};
const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const SOURCES = ["apps/studio/src", "packages/core/src", "packages/render/src", "packages/cli/src"];
const files = SOURCES.flatMap((dir) => walk(path.join(ROOT, dir))).map(rel);
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

/** A specifier as a repository path, for the workspace's own code; null for third-party packages. */
const resolveSpec = (from: string, spec: string) => {
  if (spec.startsWith("@/")) return "apps/studio/src/" + spec.slice(2);
  if (spec.startsWith("@agentcut/core/")) return "packages/core/src/" + spec.slice("@agentcut/core/".length);
  if (spec.startsWith("@agentcut/render/")) return "packages/render/src/" + spec.slice("@agentcut/render/".length);
  if (spec.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return null;
};
const pkg = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

const inServer = (file: string) => /(^|\/)server\//.test(file);
const isTest = (file: string) => file.includes("/__tests__/");
const inCore = (file: string) => file.startsWith("packages/core/");

test("everything lives in a module or in common: no src/lib, no src/components", () => {
  for (const file of files.filter((f) => f.startsWith("apps/studio/src/"))) {
    assert.ok(/^apps\/studio\/src\/(app|common|modules)\//.test(file), `${file} is outside app, common and modules`);
  }
  for (const file of files.filter(inCore)) {
    assert.ok(/^packages\/core\/src\/(common|modules|types)\//.test(file), `${file} is outside common and modules`);
  }
});

test("core has no face: no React, no Next, no icons, no .tsx", () => {
  const UI = new Set(["react", "react-dom", "next", "next-themes", "lucide-react", "@base-ui/react", "sonner", "cn", "class-variance-authority", "@remotion/player", "remotion"]);
  const bad: string[] = [];
  for (const file of files.filter(inCore)) {
    if (file.endsWith(".tsx")) bad.push(`${file} is a component`);
    for (const { spec, typeOnly } of imports(file)) {
      if (typeOnly) continue;
      if (UI.has(pkg(spec))) bad.push(`${file} -> ${spec}`);
      const target = resolveSpec(file, spec);
      if (target && !target.startsWith("packages/core/")) bad.push(`${file} -> ${spec} (outside core)`);
    }
  }
  assert.deepEqual(bad, [], "core is shared by the CLI, which has no browser; move UI to apps/studio");
});

test("the CLI reaches core only: never the studio, never Next", () => {
  const bad: string[] = [];
  for (const file of files.filter((f) => f.startsWith("packages/cli/"))) {
    for (const { spec, typeOnly } of imports(file)) {
      if (typeOnly) continue;
      const target = resolveSpec(file, spec);
      if (["next", "react", "react-dom"].includes(pkg(spec)) || target?.startsWith("apps/")) bad.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the heavy runtime is loaded in one place, never imported outright", () => {
  // ffmpeg and Remotion's renderer are what the CLI downloads on first use. An import
  // anywhere else would put them back in the CLI bundle and in the studio's trace.
  const HEAVY = new Set(["@remotion/renderer", "@remotion/bundler", "@remotion/tailwind-v4", "ffmpeg-static", "ffprobe-static"]);
  const bad: string[] = [];
  for (const file of files.filter((f) => (inCore(f) || f.startsWith("packages/cli/")) && !isTest(f))) {
    for (const { spec, typeOnly } of imports(file)) if (!typeOnly && HEAVY.has(pkg(spec))) bad.push(`${file} -> ${spec}`);
  }
  assert.deepEqual(bad, [], "load these through render/server/remotion.ts or common/server/bin.ts");
});

test("node-only code is only reached from server code, routes, the CLI and tests", () => {
  const bad: string[] = [];
  for (const file of files) {
    if (inServer(file) || isTest(file) || file.startsWith("apps/studio/src/app/") || file.startsWith("packages/cli/")) continue;
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
  const hooks = (f: string) => /^apps\/studio\/src\/(modules|common)\/.*(\/hooks\/|\/hooks\.ts$)/.test(f);
  for (const file of files.filter((f) => (/^apps\/studio\/src\/modules\/.*\.tsx$/.test(f) || hooks(f)) && !isTest(f))) {
    for (const statement of parse(file).statements) {
      if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue;
      if (/Props$/.test(statement.name.text)) continue;
      bad.push(`${file}: ${statement.name.text}`);
    }
  }
  assert.deepEqual(bad, [], "move these to the module's types.ts in core");
});

test("pages only load and render: no database, no server plumbing", () => {
  const bad: string[] = [];
  for (const file of files.filter((f) => /^apps\/studio\/src\/app\/.*page\.tsx$/.test(f))) {
    for (const { spec } of imports(file)) {
      if (/common\/server\//.test(spec) || /\/server\/(store|db|jobs|reaper)$/.test(spec)) bad.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
