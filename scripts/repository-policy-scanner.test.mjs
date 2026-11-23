import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { normalizePinFindings, scanActionPins } from "./repository-policy-scanner.mjs";

const path = ".github/workflows/check.yml";
const location = (absolute, reference, key = "uses") => ({
  symbolic: { key: { Local: { verbatim_path: absolute } }, kind: "Primary",
    route: { route: [{ Key: "jobs" }, { Key: "check" }, { Key: key }] },
    feature_kind: { Subfeature: { after: 0, fragment: { Raw: reference } } } },
  concrete: { location: { start_point: { row: 4, column: 10 } } },
});
const finding = (absolute, reference, extra = {}) => ({ ident: "unpinned-uses", ignored: false,
  locations: [location(absolute, reference)], ...extra });

test("parser-produced references include quoted, flow and ignored findings with exact source identities", () => {
  const files = new Map([["/isolated/check.yml", path]]);
  assert.deepEqual(normalizePinFindings([
    finding("/isolated/check.yml", "actions/checkout@v7", { ignored: true }),
    finding("/isolated/check.yml", "alpine:latest", { ident: "unpinned-images" }),
    finding("/isolated/check.yml", "alpine:latest", { ident: "unpinned-images", locations: [location("/isolated/check.yml", "alpine:latest", "container")] }),
    { ident: "other-audit" },
  ], files), [
    { kind: "workflow", path, reference: "actions/checkout@v7", line: 5 },
    { kind: "workflow", path, reference: "docker://alpine:latest", line: 5 },
  ]);
});

test("real pinned parser catches flow mappings, comments, reusable calls and Docker actions, and rejects invalid YAML", {
  skip: !process.env.POLICY_TEST_SCANNER,
}, () => {
  const binary = process.env.POLICY_TEST_SCANNER;
  const yaml = `name: Parser test
on: push
permissions: {}
jobs:
  called:
    uses: example/tooling/.github/workflows/check.yml@main
  check:
    runs-on: ubuntu-24.04
    container: ubuntu:24.04
    steps:
      - {uses: 'example/action@v1'} # zizmor: ignore[unpinned-uses]
      - uses: docker://alpine:latest
      - uses: actions/checkout@${"a".repeat(40)}
`;
  const results = scanActionPins(new Map([[path, Buffer.from(yaml)]]), { binary });
  assert.deepEqual(results.map(item => item.reference).sort(), ["docker://alpine:latest", "example/action@v1", "example/tooling/.github/workflows/check.yml@main"]);
  for (const invalid of ["on: [unterminated", "on: push\njobs: []\n", "on: push\njobs: {}\njobs: {}\n"]) {
    assert.throws(() => scanActionPins(new Map([[path, Buffer.from(invalid)]]), { binary }), /scanner/i);
  }
  const action = Buffer.from("name: Composite\ndescription: Test\nruns:\n  using: composite\n  steps:\n    - uses: example/action@v1\n");
  assert.equal(scanActionPins(new Map([[".github/actions/example/action.yml", action]]), { binary })[0].reference, "example/action@v1");
});

test("scanner source and diagnostic limits fail before accepting a partial scan", () => {
  const binary = "/reviewed/zizmor";
  const run = () => { throw new Error("must not execute"); };
  assert.throws(() => scanActionPins(new Map([[path, Buffer.alloc(1024 * 1024 + 1)]]), { binary, run }), /scanner/i);
  assert.throws(() => scanActionPins(new Map([["../action.yml", Buffer.from("bad")]]), { binary, run }), /scanner/i);
  assert.throws(() => normalizePinFindings(Array(10001).fill({ ident: "other" }), new Map()), /scanner/i);
});

test("selected scanner diagnostics cannot impersonate another path or omit their parsed reference", () => {
  const files = new Map([["/isolated/check.yml", path]]);
  for (const value of [null, {}, [null], [{ ident: 1 }], [finding("/elsewhere", "actions/checkout@v7")],
    [finding("/isolated/check.yml", "secret\nvalue")], [finding("/isolated/check.yml", "x", { locations: [] })],
    [finding("/isolated/check.yml", "x", { locations: [location("/isolated/check.yml", "x"), location("/isolated/check.yml", "x")] })]]) {
    assert.throws(() => normalizePinFindings(value, files), /scanner/i);
  }
});

test("scanner runs only isolated committed bytes with offline config-free parsing and bounded sanitized failures", () => {
  let calls = 0;
  const files = new Map([[path, Buffer.from("on: push\njobs: {}\n")]]);
  const run = (binary, args, options) => {
    calls++;
    assert.equal(binary, "/reviewed/zizmor");
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.ZIZMOR_CONFIG, undefined);
    assert.ok(options.timeout <= 120000);
    assert.ok(options.maxBuffer <= 8 * 1024 * 1024);
    if (args[0] === "--version") return { status: 0, stdout: "zizmor 1.32.0\n" };
    for (const flag of ["--offline", "--no-config", "--no-ignores", "--ignore-lockfile", "--strict-collection", "--no-exit-codes"]) assert.ok(args.includes(flag));
    const staged = args.at(-1);
    assert.equal(readFileSync(staged, "utf8"), files.get(path).toString());
    return { status: 0, stdout: JSON.stringify([finding(staged, "actions/checkout@v7")]) };
  };
  assert.equal(scanActionPins(files, { binary: "/reviewed/zizmor", run })[0].reference, "actions/checkout@v7");
  assert.equal(calls, 2);
  for (const result of [{ status: 1, stderr: "secret source text" }, { status: null, error: Error("secret") },
    { status: 0, stdout: "unexpected output secret" }]) {
    assert.throws(() => scanActionPins(files, { binary: "/reviewed/zizmor", run: (_binary, args) =>
      args[0] === "--version" ? { status: 0, stdout: "zizmor 1.32.0\n" } : result }), error =>
      /scanner/i.test(error.message) && !error.message.includes("secret"));
  }
  assert.throws(() => scanActionPins(files, { binary: "/reviewed/zizmor", run: () => ({ status: 0, stdout: "zizmor 1.33.1\n" }) }), /version/i);
});
