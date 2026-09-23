import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, importsOf } from "../../../scripts/check_layers.ts";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "layers-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("check_layers", () => {
  it("passes an allowed @hydra import", () => {
    const root = repo({ "packages/hunter/src/a.ts": 'import { x } from "@hydra/core";' });
    assert.deepEqual(check(root, { hunter: ["core"] }), []);
  });

  it("flags a forbidden @hydra import", () => {
    const root = repo({ "packages/hunter/src/a.ts": 'import { x } from "@hydra/exec";' });
    const v = check(root, { hunter: ["core"] });
    assert.equal(v.length, 1);
    assert.equal(v[0]?.to, "exec");
  });

  it("flags a forbidden RELATIVE import that climbs into another package", () => {
    // The form that slips past review: it does not look like a dependency.
    const root = repo({ "packages/hunter/src/deep/a.ts": 'import { x } from "../../../exec/src/y.ts";' });
    const v = check(root, { hunter: ["core"] });
    assert.equal(v.length, 1);
    assert.equal(v[0]?.to, "exec");
  });

  it("ignores relative imports within the same package", () => {
    const root = repo({ "packages/hunter/src/a.ts": 'import { x } from "./b.ts";' });
    assert.deepEqual(check(root, { hunter: [] }), []);
  });

  it("denies by default: an unlisted package may import nothing in-repo", () => {
    const root = repo({ "packages/newpkg/src/a.ts": 'import { x } from "@hydra/core";' });
    assert.equal(check(root, { hunter: ["core"] }).length, 1);
  });

  it("catches `import type` too -- a type edge is still an edge", () => {
    const root = repo({ "packages/hunter/src/a.ts": 'import type { X } from "@hydra/exec";' });
    assert.equal(check(root, { hunter: [] }).length, 1);
  });

  it("catches re-exports", () => {
    const root = repo({ "packages/hunter/src/a.ts": 'export * from "@hydra/exec";' });
    assert.equal(check(root, { hunter: [] }).length, 1);
  });

  it("ignores node: and third-party specifiers", () => {
    const root = repo({ "packages/hunter/src/a.ts": 'import { x } from "node:fs";\nimport z from "zod";' });
    assert.deepEqual(check(root, { hunter: [] }), []);
  });

  it("reads multi-line imports", () => {
    assert.deepEqual(importsOf('import {\n  a,\n  b,\n} from "@hydra/core";'), ["@hydra/core"]);
  });

  it("the real repo is clean against the real rules", () => {
    const rules = JSON.parse(readFileSync("ops/layers.json", "utf8"));
    assert.deepEqual(check(process.cwd(), rules.allow), []);
  });

  it("the real rules keep hunt and exec apart in BOTH directions", () => {
    // SPEC section 1: hunt never signs, exec never scrapes. As import edges.
    const { allow } = JSON.parse(readFileSync("ops/layers.json", "utf8"));
    assert.ok(!allow.hunter.includes("exec"));
    assert.ok(!allow.exec.includes("hunter"));
    assert.ok(!allow.exec.includes("intel"));
    assert.ok(!allow.decide.includes("exec"));
    assert.deepEqual(allow.core, []);
  });
});
