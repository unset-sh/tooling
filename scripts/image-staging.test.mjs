// What the staging image workflow refuses before it builds and before it pushes. Each test names the mistake.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_IMAGE, checkDockerfile, checkLayout, license, pinnedImages } from "./image-staging.mjs";

const D = "a".repeat(64);
const E = "b".repeat(64);
const script = fileURLToPath(new URL("./image-staging.mjs", import.meta.url));

function scratch(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

test("an image pinned by digest is accepted with or without a tag, a registry and a port", () => {
  for (const reference of [`oven/bun:1.4.4@sha256:${D}`, `oven/bun@sha256:${D}`, `ghcr.io/unset-sh/base:1@sha256:${D}`,
    `localhost:5000/a/b_c__d--e.f@sha256:${D}`, `docker.io/library/postgres:18.1-alpine@sha256:${D}`]) {
    assert.match(reference, PINNED_IMAGE, reference);
  }
  for (const reference of ["oven/bun:1.4.4", "oven/bun", "oven/bun:latest", `oven/bun:1@sha256:${"A".repeat(64)}`,
    `oven/bun:1@sha256:${D.slice(1)}`, `oven/bun:1@sha512:${D}${D}`, `oven/Bun@sha256:${D}`, `oven/bun@sha256:${D} `,
    `oven/bun@sha256:${D}\nx`, `-oven/bun@sha256:${D}`]) {
    assert.doesNotMatch(reference, PINNED_IMAGE, JSON.stringify(reference));
  }
});

test("a base image by a tag that can move is refused, naming the line", () => {
  assert.deepEqual(pinnedImages(`FROM oven/bun:1.4.4@sha256:${D}\nRUN true\n`), [`oven/bun:1.4.4@sha256:${D}`]);
  assert.throws(() => pinnedImages("FROM oven/bun:1.4.4\n"), /line 1: FROM 'oven\/bun:1\.4\.4' is not pinned by digest/);
  assert.throws(() => pinnedImages("# a comment\n\nfrom oven/bun\n"), /line 3: FROM 'oven\/bun'/);
  assert.throws(() => pinnedImages(`FROM --platform=linux/amd64 oven/bun:1\n`), /line 1: FROM 'oven\/bun:1'/);
  assert.deepEqual(pinnedImages(`FROM --platform=$BUILDPLATFORM oven/bun@sha256:${D} AS build\n`), [`oven/bun@sha256:${D}`]);
});

test("an image named through a build argument is refused, because its value is not in the file", () => {
  assert.throws(() => pinnedImages(`ARG BASE=oven/bun@sha256:${D}\nFROM \${BASE}\n`), /line 2: FROM '\$\{BASE\}' uses a build argument/);
  assert.throws(() => pinnedImages(`ARG TAG=1\nFROM oven/bun:$TAG@sha256:${D}\n`), /uses a build argument/);
});

test("earlier stages and scratch need no digest, a later or unknown stage name does", () => {
  const text = `FROM oven/bun@sha256:${D} AS Build\nRUN true\nFROM build AS test\nFROM scratch\nCOPY --from=build /a /a\nCOPY --from=1 /b /b\n`;
  assert.deepEqual(pinnedImages(text), [`oven/bun@sha256:${D}`]);
  assert.throws(() => pinnedImages(`FROM scratch\nCOPY --from=3 /a /a\n`), /COPY --from '3' is not pinned/);
  assert.throws(() => pinnedImages(`FROM later\nFROM scratch AS later\n`), /FROM 'later' is not pinned/);
});

test("images pulled by COPY --from and RUN --mount from= are held to the same rule", () => {
  assert.deepEqual(pinnedImages(`FROM scratch\nCOPY --chown=1 --from=alpine@sha256:${E} /a /a\n`), [`alpine@sha256:${E}`]);
  assert.throws(() => pinnedImages("FROM scratch\nCOPY --from=alpine:3 /a /a\n"), /line 2: COPY --from 'alpine:3'/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN --mount=type=bind,from=alpine:3,target=/x true\n"), /RUN --mount from 'alpine:3'/);
  assert.deepEqual(pinnedImages(`FROM scratch\nRUN --mount=type=cache,target=/c --mount=type=bind,from=alpine@sha256:${E},target=/x true\n`), [`alpine@sha256:${E}`]);
});

test("the syntax directive pulls the frontend as an image and must be pinned too", () => {
  assert.deepEqual(pinnedImages(`# syntax=docker/dockerfile:1@sha256:${E}\nFROM scratch\n`), [`docker/dockerfile:1@sha256:${E}`]);
  assert.throws(() => pinnedImages("# syntax=docker/dockerfile:1\nFROM scratch\n"), /the syntax directive 'docker\/dockerfile:1'/);
  // After a comment no directive is read, as in Docker: this line is a comment and pulls nothing.
  assert.deepEqual(pinnedImages("# hello\n# syntax=docker/dockerfile:1\nFROM scratch\n"), []);
});

test("continued lines are joined, comments inside them dropped, and a FROM on a continued line still found", () => {
  assert.throws(() => pinnedImages("FROM \\\n  # note\n  oven/bun:1\n"), /line 1: FROM 'oven\/bun:1'/);
  assert.throws(() => pinnedImages("# escape=`\nFROM `\n  oven/bun:1\n"), /FROM 'oven\/bun:1'/);
  assert.throws(() => pinnedImages("# escape=x\nFROM scratch\n"), /escape directive/);
});

test("a heredoc body is not read as instructions, and an unclosed heredoc is refused", () => {
  const text = `FROM scratch\nRUN <<EOF\nFROM oven/bun:latest\nEOF\nCOPY <<-"A" <<'B' /x\n\tFROM a\n\tA\nFROM b\nB\n`;
  assert.deepEqual(pinnedImages(text), []);
  assert.throws(() => pinnedImages("FROM scratch\nRUN <<EOF\necho\n"), /heredoc EOF opened on line 2 is never closed/);
});

// Each Dockerfile below passed the check at b548b96 while BuildKit v0.35.0 pulled the unpinned image (review of
// tooling PR 26, 2026-11-24, and frontend/dockerfile/parser/*.go at v0.35.0). The check now reads each shape as
// BuildKit does or refuses it.
test("a quoted or glued '<<' is not taken for a heredoc, and only the plain heredoc forms are read", () => {
  assert.throws(() => pinnedImages(`FROM alpine@sha256:${D}\nRUN echo "<<EOF"\nFROM evil:latest AS evil\nRUN <<EOF\nEOF\n`), /line 2: .*plain form/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN x<<EOF\nFROM evil:latest\nEOF\n"), /line 2: .*plain form/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN cat <<EOF \"$HOME\"\nEOF\n"), /line 2: .*plain form/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN cat <<< word\n"), /line 2: .*plain form/);
  // BuildKit splits a heredoc line with \ as its escape whatever the escape directive says (parser.go
  // heredocsFromLine), so with ` as the escape, `a\ <<EOF` is one word and opens no heredoc.
  assert.throws(() => pinnedImages(`# escape=\`\nFROM alpine@sha256:${D}\nRUN echo a\\ <<EOF\nFROM evil:latest AS evil\nRUN <<EOF\nEOF\n`), /line 3: .*plain form/);
  assert.deepEqual(pinnedImages("FROM scratch\nRUN 3<<EOF cat <&3\nFROM evil\nEOF\nONBUILD RUN <<EOF\nFROM evil\nEOF\n"), []);
});

test("a heredoc ends where BuildKit ends it, at a line that is its name once line ends are trimmed", () => {
  assert.throws(() => pinnedImages("FROM scratch\nRUN <<EOF\nEOF\r\r\nFROM evil:latest\nRUN <<EOF\nEOF\n"), /line 4: FROM 'evil:latest'/);
});

test("a #! first line is refused, because BuildKit skips it before it reads the syntax directive", () => {
  assert.throws(() => pinnedImages("#!/usr/bin/env docker-build\n# syntax=docker/dockerfile:1\nFROM scratch\n"), /line 1: .*#!/);
});

test("a syntax line in another comment style, or a Dockerfile in JSON, is refused", () => {
  assert.throws(() => pinnedImages("// syntax=evil:latest\nFROM scratch\n"), /line 1: '\/\/' is not a Dockerfile instruction/);
  assert.throws(() => pinnedImages('{"syntax": "evil:latest"}\n'), /line 1: .* is not a Dockerfile instruction/);
});

test("a flag with a quote, an escape character or a non-ASCII character is refused", () => {
  for (const flag of ["--fr\\om=evil:latest", '--"from"=evil:latest', "--from='evil'", "--fr`om=evil", "--chown=1\u00e0--from=evil:latest"]) {
    assert.throws(() => pinnedImages(`FROM scratch\nCOPY ${flag} /a /b\n`), /line 2: the flag .* may not contain/, flag);
  }
  assert.throws(() => pinnedImages('FROM scratch\nRUN --mount=type=bind,"from=evil:latest",target=/x true\n'), /line 2: the flag/);
  assert.throws(() => pinnedImages('FROM scratch\nCOPY --from="alpine" /a /b\n'), /line 2: the flag/);
});

test("continued lines are joined as BuildKit joins them: no space added, empty lines skipped, an escaped escape ends the line", () => {
  assert.throws(() => pinnedImages("FROM scratch\nCOPY --fr\\\nom=evil:latest /a /b\n"), /line 2: COPY --from 'evil:latest'/);
  assert.throws(() => pinnedImages("FROM scratch\nCOPY --fr\\\n\n  \nom=evil:latest /a /b\n"), /line 2: COPY --from 'evil:latest'/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN echo \\\\\nFROM evil:latest\n"), /line 3: FROM 'evil:latest'/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN echo hi\nom=evil:latest\n"), /line 3: 'om=evil:latest' is not a Dockerfile instruction/);
});

test("parser directives are read as BuildKit reads them, indented too, and odd whitespace is refused", () => {
  assert.throws(() => pinnedImages(" # escape=`\nFROM scratch\nRUN echo \\\nFROM evil:latest\n"), /line 4: FROM 'evil:latest'/);
  assert.throws(() => pinnedImages("#\u0085escape=`\nFROM scratch\nRUN echo \\\nFROM evil:latest\n"), /line 1: .*whitespace/);
  assert.throws(() => pinnedImages("FROM scratch\nRUN echo\u00a0hi\n"), /line 2: .*whitespace/);
});

test("FROM and RUN --mount name earlier stages only by name; only COPY --from takes a stage number", () => {
  assert.throws(() => pinnedImages(`FROM alpine@sha256:${D}\nFROM 0\n`), /line 2: FROM '0' is not pinned/);
  assert.throws(() => pinnedImages(`FROM alpine@sha256:${D}\nRUN --mount=from=0,target=/x true\n`), /line 2: RUN --mount from '0' is not pinned/);
  assert.deepEqual(pinnedImages(`FROM alpine@sha256:${D}\nFROM scratch\nCOPY --from=0 /a /a\n`), [`alpine@sha256:${D}`]);
});

test("a Dockerfile with no FROM, or with an instruction before the first FROM, is refused", () => {
  assert.throws(() => pinnedImages("# nothing\n"), /no FROM/);
  assert.throws(() => pinnedImages(`RUN true\nFROM oven/bun@sha256:${D}\n`), /line 1: only ARG may come before the first FROM/);
  assert.throws(() => pinnedImages(`FROM oven/bun@sha256:${D} extra\n`), /words after the image/);
});

test("the context and the Dockerfile must be plain paths inside the repository, reached without links", () => {
  const base = scratch("image-dockerfile-");
  const repository = join(base, "repository");
  mkdirSync(join(repository, "docker"), { recursive: true });
  writeFileSync(join(repository, "Dockerfile"), `FROM oven/bun@sha256:${D}\n`);
  writeFileSync(join(base, "Elsewhere"), `FROM oven/bun@sha256:${D}\n`);
  assert.deepEqual(checkDockerfile(repository, ".", "Dockerfile"), [`oven/bun@sha256:${D}`]);
  assert.deepEqual(checkDockerfile(repository, "docker", "Dockerfile"), [`oven/bun@sha256:${D}`]);
  for (const path of ["../Elsewhere", "/etc/passwd", "docker/../../Elsewhere", "", "./Dockerfile", "a b", "-f"]) {
    assert.throws(() => checkDockerfile(repository, ".", path), /not a plain relative path/, JSON.stringify(path));
  }
  assert.throws(() => checkDockerfile(repository, "..", "Dockerfile"), /context '\.\.' is not a plain relative path/);
  assert.throws(() => checkDockerfile(repository, ".", "Missing"), /does not exist/);
  assert.throws(() => checkDockerfile(repository, "Dockerfile", "Dockerfile"), /context 'Dockerfile' is not a folder/);
  assert.throws(() => checkDockerfile(repository, ".", "docker"), /not a regular file/);
  symlinkSync(join(base, "Elsewhere"), join(repository, "Linked"));
  assert.throws(() => checkDockerfile(repository, ".", "Linked"), /symbolic link/);
  symlinkSync(base, join(repository, "up"));
  assert.throws(() => checkDockerfile(repository, "up", "Dockerfile"), /symbolic link/);
  rmSync(base, { recursive: true, force: true });
});

test("the licence label comes from package.json and must be a plain SPDX expression", () => {
  const base = scratch("image-license-");
  const write = (value) => {
    writeFileSync(join(base, "package.json"), JSON.stringify(value));
    return join(base, "package.json");
  };
  assert.equal(license(write({ license: "AGPL-3.0-only" })), "AGPL-3.0-only");
  assert.equal(license(write({ license: "MIT OR Apache-2.0" })), "MIT OR Apache-2.0");
  for (const value of [{}, { license: "" }, { license: ["MIT"] }, { license: "MIT\nX" }, { license: "MIT;rm" }, { license: "x".repeat(257) }]) {
    assert.throws(() => license(write(value)), /SPDX/, JSON.stringify(value));
  }
  rmSync(base, { recursive: true, force: true });
});

const SOURCE = "https://github.com/unset-sh/backend";
const REVISION = "c".repeat(40);

/** Writes a layout shaped like the one BuildKit 0.35.0 wrote for `--output type=oci,tar=false` (seen 2026-11-24). */
function layout({ platform = { architecture: "amd64", os: "linux" }, labels, manifests, extraBlob = false } = {}) {
  const folder = scratch("image-layout-");
  mkdirSync(join(folder, "blobs", "sha256"), { recursive: true });
  const blob = (bytes) => {
    const hex = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(folder, "blobs", "sha256", hex), bytes);
    return { digest: `sha256:${hex}`, size: Buffer.byteLength(bytes) };
  };
  const layer = blob("layer bytes");
  const config = blob(JSON.stringify({
    architecture: platform.architecture, os: platform.os,
    config: { Labels: labels ?? { "org.opencontainers.image.source": SOURCE, "org.opencontainers.image.revision": REVISION, "org.opencontainers.image.licenses": "AGPL-3.0-only" } },
  }));
  const manifest = blob(JSON.stringify({
    schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", ...layer }],
  }));
  if (extraBlob) blob("not named by the image");
  writeFileSync(join(folder, "oci-layout"), '{"imageLayoutVersion":"1.0.0"}');
  writeFileSync(join(folder, "index.json"), JSON.stringify({
    schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: manifests ?? [{ mediaType: "application/vnd.oci.image.manifest.v1+json", ...manifest, platform }],
  }));
  return { folder, manifest, layer, config };
}

test("a layout with one image for the platform gives that image's manifest digest", async () => {
  const { folder, manifest } = layout();
  assert.equal(await checkLayout(folder, "linux/amd64", SOURCE, REVISION), manifest.digest);
  const result = spawnSync(process.execPath, [script, "layout", folder, "linux/amd64", SOURCE, REVISION], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${manifest.digest}\n`);
});

test("a layout for another platform, or an unknown platform, is refused", async () => {
  await assert.rejects(checkLayout(layout().folder, "linux/arm64", SOURCE, REVISION), /expected linux\/arm64/);
  await assert.rejects(checkLayout(layout().folder, "linux/riscv64", SOURCE, REVISION), /not one of/);
});

test("a layout with no image, two images or an index inside is refused", async () => {
  const { folder, manifest } = layout();
  await assert.rejects(checkLayout(layout({ manifests: [] }).folder, "linux/amd64", SOURCE, REVISION), /names 0 manifests/);
  const entry = { mediaType: "application/vnd.oci.image.manifest.v1+json", ...manifest, platform: { architecture: "amd64", os: "linux" } };
  writeFileSync(join(folder, "index.json"), JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [entry, entry] }));
  await assert.rejects(checkLayout(folder, "linux/amd64", SOURCE, REVISION), /names 2 manifests/);
  writeFileSync(join(folder, "index.json"), JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{ ...entry, mediaType: "application/vnd.oci.image.index.v1+json" }] }));
  await assert.rejects(checkLayout(folder, "linux/amd64", SOURCE, REVISION), /media type 'application\/vnd\.oci\.image\.index\.v1\+json'/);
});

test("a blob whose bytes do not hash to its name, or a blob the image does not name, is refused", async () => {
  const { folder, layer } = layout();
  writeFileSync(join(folder, "blobs", "sha256", layer.digest.slice(7)), "other bytes");
  await assert.rejects(checkLayout(folder, "linux/amd64", SOURCE, REVISION), /does not hash to its name/);
  await assert.rejects(checkLayout(layout({ extraBlob: true }).folder, "linux/amd64", SOURCE, REVISION), /blobs the image does not name/);
});

test("anything but the three layout entries, a link or an oddly named blob is refused", async () => {
  const extra = layout().folder;
  writeFileSync(join(extra, "notes.txt"), "x");
  await assert.rejects(checkLayout(extra, "linux/amd64", SOURCE, REVISION), /the layout holds/);
  const linked = layout();
  const hex = linked.layer.digest.slice(7);
  rmSync(join(linked.folder, "blobs", "sha256", hex));
  symlinkSync("/etc/hostname", join(linked.folder, "blobs", "sha256", hex));
  await assert.rejects(checkLayout(linked.folder, "linux/amd64", SOURCE, REVISION), /not a regular file/);
  const named = layout().folder;
  writeFileSync(join(named, "blobs", "sha256", "ingest"), "x");
  await assert.rejects(checkLayout(named, "linux/amd64", SOURCE, REVISION), /not named by a SHA-256 digest/);
});

test("an image without this run's source and revision labels is refused", async () => {
  await assert.rejects(checkLayout(layout().folder, "linux/amd64", "https://github.com/unset-sh/web", REVISION), /source label/);
  await assert.rejects(checkLayout(layout().folder, "linux/amd64", SOURCE, "d".repeat(40)), /revision label/);
  const unlicensed = layout({ labels: { "org.opencontainers.image.source": SOURCE, "org.opencontainers.image.revision": REVISION } });
  await assert.rejects(checkLayout(unlicensed.folder, "linux/amd64", SOURCE, REVISION), /licenses label/);
});

test("the command line refuses a relative layout folder and unknown commands", () => {
  for (const args of [["layout", "relative", "linux/amd64", SOURCE, REVISION], ["push"], []]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /^usage: image-staging\.mjs/);
  }
});
