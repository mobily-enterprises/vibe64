// Compresses a client build's files once, after `vite build` (package.json's build scripts): a brotli (.br) and a
// gzip (.gz) copy beside each file under the build's assets folder, which the server sends a browser that accepts it
// (server/lib/spaFallback.js). index.html and every other file outside assets/ stay as they are.
// Usage: node tooling/release/precompress-assets.mjs <dist>
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipFile = promisify(gzip);

// The formats that shrink when compressed. Images, woff and woff2 fonts are compressed already.
const COMPRESSIBLE = /\.(?:css|ico|js|json|mjs|otf|svg|ttf|wasm)$/u;
// A smaller file fits in a packet or two either way.
const MIN_BYTES = 1024;

/**
 * Writes a file's brotli and gzip copies beside it, for a format that compresses, each only when it is smaller than
 * the file.
 * @param {string} file
 * @returns {Promise<string[]>} the copies written
 */
async function precompressFile(file) {
  if (!COMPRESSIBLE.test(file)) return [];
  const body = await readFile(file);
  if (body.length < MIN_BYTES) return [];
  const copies = await Promise.all([
    brotli(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: body.length
      }
    }).then((compressed) => [`${file}.br`, compressed]),
    gzipFile(body, { level: constants.Z_BEST_COMPRESSION }).then((compressed) => [`${file}.gz`, compressed])
  ]);
  const written = [];
  for (const [copy, compressed] of copies) {
    if (compressed.length < body.length) {
      await writeFile(copy, compressed);
      written.push(copy);
    }
  }
  return written;
}

/**
 * Compresses every file under `<distRoot>/assets`, at any depth, all at once.
 * @param {string} distRoot
 * @returns {Promise<string[]>} the copies written
 */
async function precompressBuild(distRoot) {
  const assets = path.join(distRoot, "assets");
  const entries = await readdir(assets, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
  return (await Promise.all(files.map(precompressFile))).flat();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Usage: node tooling/release/precompress-assets.mjs <dist>");
  const started = Date.now();
  const written = await precompressBuild(path.resolve(process.argv[2]));
  console.log(`Compressed copies: ${written.length} in ${Date.now() - started} ms.`);
}

export { precompressBuild, precompressFile };
