// Release versions are semantic versions everywhere; PyPI receives the PEP 440
// spelling of the same version (1.5.0-rc.1 -> 1.5.0rc1).
import { publishError } from "../errors.js";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PEP440_PRE = Object.freeze({ alpha: "a", a: "a", beta: "b", b: "b", rc: "rc", dev: ".dev", post: ".post" });

function parseSemver(version) {
  const match = SEMVER.exec(version || "");
  if (!match) {
    throw publishError("VIBE64_PUBLISH_VERSION_INVALID", `Version ${version} is not a semantic version such as 1.5.0.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function isSemver(version) {
  return SEMVER.test(version || "");
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

// Semantic Versioning 2.0.0 precedence; build metadata is ignored.
function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const part of ["major", "minor", "patch"]) {
    if (a[part] !== b[part]) return Math.sign(a[part] - b[part]);
  }
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const order = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (order) return order;
  }
  return 0;
}

// Only prereleases PEP 440 can express: alpha|a, beta|b, rc, dev, post with one number.
function pep440FromSemver(version) {
  const parsed = parseSemver(version);
  if (/\+/u.test(version)) {
    throw publishError("VIBE64_PUBLISH_VERSION_INVALID", `Version ${version} has build metadata, which PyPI does not accept.`);
  }
  const release = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (!parsed.prerelease.length) return release;
  const [label, number = "0", ...rest] = parsed.prerelease;
  const suffix = PEP440_PRE[label.toLowerCase()];
  if (!suffix || rest.length || !/^\d+$/u.test(number)) {
    throw publishError(
      "VIBE64_PUBLISH_VERSION_INVALID",
      `Version ${version} has no PyPI spelling; use a prerelease such as -alpha.1, -beta.1, -rc.1 or -dev.1.`
    );
  }
  return `${release}${suffix}${Number(number)}`;
}

export { compareSemver, isSemver, parseSemver, pep440FromSemver };
