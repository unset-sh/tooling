import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { refreshMaps } from "./refresh-maps.mjs";

const cli = fileURLToPath(new URL("./refresh-maps.mjs", import.meta.url));
const writer = `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("data/maps", { recursive: true });
writeFileSync("data/maps/one.json", JSON.stringify({ value: 1 }));`;

function fixture(t, script = writer) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "maps-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "source");
  mkdirSync(root);
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put("scripts/generate.mjs", script);
  const entry = { id: "one", generator: "scripts/generate.mjs", arguments: [], outputs: ["data/maps/one.json"] };
  const register = (maps = [entry], extra = {}) => put(".github/maps.json", JSON.stringify({ schemaVersion: 1, maps, ...extra }));
  register();
  return { directory, root, out: join(directory, "artifact"), put, entry, register };
}

test("runs every registered generator in order and stages only declared JSON at repository-relative paths", (t) => {
  const f = fixture(t);
  f.put("scripts/second.mjs", `import { readFileSync, writeFileSync } from "node:fs";
const first = JSON.parse(readFileSync("data/maps/one.json", "utf8"));
writeFileSync("data/maps/two.json", JSON.stringify({ value: first.value + 1 }));
writeFileSync("data/maps/unlisted.json", "{}");`);
  f.register([f.entry, { id: "two", generator: "scripts/second.mjs", arguments: [], outputs: ["data/maps/two.json"] }]);
  const result = refreshMaps(f);
  assert.deepEqual(result, { maps: 2, files: 2 });
  assert.equal(JSON.parse(readFileSync(join(f.out, "data/maps/two.json"), "utf8")).value, 2);
  assert.equal(existsSync(join(f.out, "data/maps/unlisted.json")), false);
  assert.equal(existsSync(join(f.out, ".github")), false);
});

test("arguments reach the script literally and cannot become shell commands or Node runtime options", (t) => {
  const f = fixture(t, `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("data/maps", { recursive: true });
writeFileSync("data/maps/one.json", JSON.stringify(process.argv.slice(2)));`);
  const args = ["--eval", "process.exit(9)", "$(touch injected)", "a; touch injected", "two words", ""];
  f.register([{ ...f.entry, arguments: args }]);
  refreshMaps(f);
  assert.deepEqual(JSON.parse(readFileSync(join(f.out, "data/maps/one.json"), "utf8")), args);
  assert.equal(existsSync(join(f.root, "injected")), false);
});

test("the temporary token is removed from the parent and passed only to the generator", (t) => {
  const f = fixture(t, `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("data/maps", { recursive: true });
if (process.env.DOCS_GITHUB_TOKEN !== "map-test-token") process.exit(7);
writeFileSync("data/maps/one.json", "{}");`);
  const previous = process.env.DOCS_GITHUB_TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.DOCS_GITHUB_TOKEN; else process.env.DOCS_GITHUB_TOKEN = previous; });
  process.env.DOCS_GITHUB_TOKEN = "map-test-token";
  refreshMaps(f);
  assert.equal(process.env.DOCS_GITHUB_TOKEN, undefined);
});

test("a failed generator exposes neither its output nor the token and leaves no partial artifact", (t) => {
  const f = fixture(t, `console.log(process.env.DOCS_GITHUB_TOKEN); console.error(process.env.DOCS_GITHUB_TOKEN); process.exit(4);`);
  const result = spawnSync(process.execPath, [cli, "--root", f.root, "--out", f.out], {
    env: { ...process.env, DOCS_GITHUB_TOKEN: "never-print-this-token" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Generator failed for map one/);
  assert.doesNotMatch(result.stdout + result.stderr, /never-print-this-token/);
  assert.equal(existsSync(f.out), false);
});

test("failure of the last map prevents publication of earlier successful maps", (t) => {
  const f = fixture(t);
  f.put("scripts/second.mjs", "process.exit(3);");
  f.register([f.entry, { id: "two", generator: "scripts/second.mjs", arguments: [], outputs: ["data/maps/two.json"] }]);
  assert.throws(() => refreshMaps(f), /Generator failed for map two/);
  assert.equal(existsSync(f.out), false);
  assert.equal(existsSync(join(f.root, "data/maps/one.json")), true);
});

test("an existing destination is never replaced, even when it contains an older valid snapshot", (t) => {
  const f = fixture(t);
  mkdirSync(f.out);
  writeFileSync(join(f.out, "previous.json"), "{\"previous\":true}");
  assert.throws(() => refreshMaps(f), /Output already exists/);
  assert.equal(readFileSync(join(f.out, "previous.json"), "utf8"), "{\"previous\":true}");
  assert.equal(existsSync(join(f.root, "data/maps/one.json")), false);
});

for (const [label, change] of [
  ["wrong schema version", (f) => f.register([f.entry], { schemaVersion: 2 })],
  ["unknown registry field", (f) => f.register([f.entry], { command: "echo anything" })],
  ["empty registry", (f) => f.register([])],
  ["unknown map field", (f) => f.register([{ ...f.entry, command: "echo anything" }])],
  ["missing arguments", (f) => { const entry = { ...f.entry }; delete entry.arguments; f.register([entry]); }],
  ["invalid argument", (f) => f.register([{ ...f.entry, arguments: [false] }])],
  ["control characters in arguments", (f) => f.register([{ ...f.entry, arguments: ["a\nb"] }])],
  ["oversized arguments", (f) => f.register([{ ...f.entry, arguments: ["a".repeat(2049)] }])],
  ["duplicate IDs", (f) => f.register([f.entry, { ...f.entry, outputs: ["data/maps/two.json"] }])],
  ["unsafe ID", (f) => f.register([{ ...f.entry, id: "one\n::error::" }])],
  ["output collision", (f) => f.register([f.entry, { ...f.entry, id: "two" }])],
  ["case collision", (f) => f.register([f.entry, { ...f.entry, id: "two", outputs: ["data/Maps/two.json"] }])],
  ["file-directory collision", (f) => f.register([{ ...f.entry, outputs: ["data/a.json", "data/a.json/nested.json"] }])],
  ["code output", (f) => f.register([{ ...f.entry, outputs: ["package.json"] }])],
  ["hidden output", (f) => f.register([{ ...f.entry, outputs: ["data/.hidden.json"] }])],
  ["source outside scripts", (f) => f.register([{ ...f.entry, generator: "data/generate.mjs" }])],
  ["traversing source", (f) => f.register([{ ...f.entry, generator: "scripts/../generate.mjs" }])],
  ["source with Node options", (f) => f.register([{ ...f.entry, generator: "--eval" }])],
  ["non-mjs source", (f) => f.register([{ ...f.entry, generator: "scripts/generate.sh" }])],
  ["traversing output", (f) => f.register([{ ...f.entry, outputs: ["data/../escaped.json"] }])],
  ["absolute output", (f) => f.register([{ ...f.entry, outputs: ["/data/escaped.json"] }])],
  ["backslash output", (f) => f.register([{ ...f.entry, outputs: ["data\\escaped.json"] }])],
  ["reserved filename", (f) => f.register([{ ...f.entry, outputs: ["data/CON.json"] }])],
  ["too many maps", (f) => f.register(Array.from({ length: 101 }, (_, i) => ({ ...f.entry, id: `map-${i}`, outputs: [`data/${i}.json`] })))],
]) {
  test(`rejects ${label} before running any generator`, (t) => {
    const f = fixture(t);
    change(f);
    assert.throws(() => refreshMaps(f));
    assert.equal(existsSync(join(f.root, "data/maps/one.json")), false);
    assert.equal(existsSync(f.out), false);
  });
}

for (const path of [".github/maps.json", "scripts/generate.mjs"]) {
  for (const kind of ["symlink", "hardlink"]) {
    test(`refuses ${kind} ${path}`, (t) => {
      const f = fixture(t);
      const original = readFileSync(join(f.root, path));
      const other = join(f.directory, "linked");
      writeFileSync(other, original);
      rmSync(join(f.root, path));
      (kind === "symlink" ? symlinkSync : linkSync)(other, join(f.root, path));
      assert.throws(() => refreshMaps(f), /regular unlinked file|symbolic link/);
      assert.equal(existsSync(f.out), false);
    });
  }
}

test("refuses a generator behind a symlinked ancestor", (t) => {
  const f = fixture(t);
  const other = join(f.directory, "other");
  mkdirSync(other);
  writeFileSync(join(other, "generate.mjs"), writer);
  rmSync(join(f.root, "scripts"), { recursive: true });
  symlinkSync(other, join(f.root, "scripts"));
  assert.throws(() => refreshMaps(f), /symbolic link/);
});

for (const [label, script] of [
  ["missing", ""],
  ["invalid JSON", `import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("data/maps", {recursive:true}); writeFileSync("data/maps/one.json", "private response body");`],
  ["invalid UTF-8", `import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("data/maps", {recursive:true}); writeFileSync("data/maps/one.json", Buffer.from([0x22, 0xff, 0x22]));`],
  ["oversized", `import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("data/maps", {recursive:true}); writeFileSync("data/maps/one.json", " ".repeat(8 * 1024 * 1024 + 1));`],
  ["symlink", `import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"; mkdirSync("data/maps", {recursive:true}); writeFileSync("data/target.json", "{}"); symlinkSync("../target.json", "data/maps/one.json");`],
  ["hardlink", `import { mkdirSync, linkSync, writeFileSync } from "node:fs"; mkdirSync("data/maps", {recursive:true}); writeFileSync("data/target.json", "{}"); linkSync("data/target.json", "data/maps/one.json");`],
  ["directory", `import { mkdirSync } from "node:fs"; mkdirSync("data/maps/one.json", {recursive:true});`],
  ["symlink ancestor", `import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"; mkdirSync("data/real", {recursive:true}); writeFileSync("data/real/one.json", "{}"); symlinkSync("real", "data/maps");`],
]) {
  test(`refuses ${label} output without staging any files or disclosing contents`, (t) => {
    const f = fixture(t, script);
    assert.throws(() => refreshMaps(f), (error) => {
      assert.doesNotMatch(error.message, /private response body/);
      return true;
    });
    assert.equal(existsSync(f.out), false);
  });
}

test("validates all outputs after all generators, including an earlier file changed by a later map", (t) => {
  const f = fixture(t);
  f.put("scripts/second.mjs", `import { writeFileSync } from "node:fs"; writeFileSync("data/maps/one.json", "broken"); writeFileSync("data/maps/two.json", "{}");`);
  f.register([f.entry, { id: "two", generator: "scripts/second.mjs", arguments: [], outputs: ["data/maps/two.json"] }]);
  assert.throws(() => refreshMaps(f), /valid UTF-8 JSON/);
  assert.equal(existsSync(f.out), false);
});

test("refuses an artifact directory inside the consumer checkout", (t) => {
  const f = fixture(t);
  assert.throws(() => refreshMaps({ ...f, out: join(f.root, "artifact") }), /outside the source repository/);
});

test("CLI rejects unknown flags and malformed registries without printing their contents", (t) => {
  const f = fixture(t);
  f.put(".github/maps.json", "private registry content");
  for (const args of [["--root", f.root, "--out", f.out], ["--command", "private command"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /private registry content|private command/);
    assert.equal(existsSync(f.out), false);
  }
});
