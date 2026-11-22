// A registry on localhost holding the packages a test packs, so real npm installs them offline.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Writes a package folder: its package.json and files ({ "index.js": "..." }).
 * @param {string} dir
 * @param {object} manifest
 * @param {Record<string, string>} files
 */
async function writePackage(dir, manifest, files = {}) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
}

/**
 * Starts the registry. `publish(dir)` packs a package folder into it; `env` points npm at it with
 * its own cache. Close it in the test's teardown.
 * @param {string} root a folder the test owns
 */
async function startFakeNpmRegistry(root) {
  const packages = new Map();
  const tarballs = new Map();
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
    if (tarballs.has(pathname)) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(tarballs.get(pathname));
      return;
    }
    const packument = packages.get(pathname);
    if (!packument) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(packument));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const env = {
    ...process.env,
    npm_config_registry: url,
    npm_config_cache: path.join(root, "npm-cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_ignore_scripts: "true"
  };
  const packed = path.join(root, "packed");
  await mkdir(packed, { recursive: true });
  async function publish(dir) {
    const { stdout } = await exec("npm", ["pack", "--json", "--pack-destination", packed], { cwd: dir, env });
    const [{ name, version, filename }] = JSON.parse(stdout);
    const bytes = await readFile(path.join(packed, filename));
    const tarball = `-/${filename}`;
    tarballs.set(tarball, bytes);
    const manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    const packument = packages.get(name) || { name, versions: {}, "dist-tags": {} };
    packument.versions[version] = {
      ...manifest,
      dist: {
        tarball: `${url}${tarball}`,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        shasum: createHash("sha1").update(bytes).digest("hex")
      }
    };
    packument["dist-tags"].latest = Object.keys(packument.versions).sort().at(-1);
    packages.set(name, packument);
  }
  return {
    env,
    publish,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

export { startFakeNpmRegistry, writePackage };
