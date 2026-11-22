// Builds tar archives byte by byte for the checks, in the form `npm pack` writes, with a hook to bend one
// header out of that form. The repository has no dependencies, and a tar library would also refuse to write
// most of the archives the checks need.
import { gzipSync } from "node:zlib";

const BLOCK = 512;

/** The two empty blocks that close an archive. */
export const END = Buffer.alloc(2 * BLOCK);

/**
 * One header. `before` may change the block before its checksum is written, so the checksum stays right and
 * a check fails for the field it is about; `after` changes it once the checksum is in.
 */
export function header({ name, folder = "", size, type = "0" }, { before, after } = {}) {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, "latin1");
  block.write("000644 \0", 100, "latin1");
  block.write(`${size.toString(8).padStart(10, "0")} \0`, 124, "latin1");
  block.write("3560116604 \0", 136, "latin1");
  block.write(type, 156, "latin1");
  block.write("ustar\x0000", 257, "latin1");
  block.write("000000 \0", 329, "latin1");
  block.write("000000 \0", 337, "latin1");
  block.write(folder, 345, "latin1");
  before?.(block);
  block.fill(" ", 148, 156);
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, "0")} \0`, 148, "latin1");
  after?.(block);
  return block;
}

/** A header and its content, padded to whole blocks. `fields` and `hooks` are passed on to `header`. */
export function entry(path, content, fields = {}, hooks = {}) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === "string" ? content : JSON.stringify(content));
  const padding = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK);
  return Buffer.concat([header({ name: path, size: data.length, ...fields }, hooks), data, padding]);
}

/** A packed package made of these parts, closed and gzipped. */
export function packed(...parts) {
  return gzipSync(Buffer.concat([...parts, END]));
}
