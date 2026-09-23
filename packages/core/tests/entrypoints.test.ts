import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * Every script package.json advertises must point at a file that exists.
 *
 * `hunt`, `promote`, `replay` and `smoke` were advertised from the first
 * commit and none of the four files existed. The missing `hunt` is why the
 * paper clock sat at zero for weeks while every library passed its tests.
 * `promote`, `replay` and `smoke` were removed on 2026-09-23 rather than
 * stubbed; each comes back in the commit that writes its real file.
 * `smoke_dust_swap` is exec-plane and must not exist before the gate passes.
 */
describe("package.json entry points", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;

  for (const [name, cmd] of Object.entries(scripts)) {
    const file = /(?:^|\s)((?:scripts|apps)\/[\w./-]+\.(?:ts|js|sh))/.exec(cmd)?.[1];
    if (!file) continue;
    it(`${name} -> ${file} exists`, () => {
      assert.ok(existsSync(file), `package.json advertises "${name}" but ${file} does not exist`);
    });
  }

  it("found at least one advertised script to check (not vacuous)", () => {
    assert.ok(Object.values(scripts).some((c) => /scripts\/\S+\.ts/.test(c)));
  });
});
