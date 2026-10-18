// Decorative cover art for a course card, derived only from the course ID so
// the same course always looks the same. It encodes no progress or status.

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const patterns = Object.freeze(["waves", "orbits", "grid", "peaks"]);

function courseArt(courseId) {
  const hash = hashText(courseId);
  const hue = hash % 360;
  const shift = 35 + (hash >>> 9) % 50;
  return {
    id: `v64-course-art-${hash.toString(36)}`,
    pattern: patterns[(hash >>> 3) % patterns.length],
    // Dark enough for white decorative marks; text never sits directly on the art.
    from: `hsl(${hue} 62% 38%)`,
    to: `hsl(${(hue + shift) % 360} 70% 52%)`,
    accent: `hsl(${(hue + shift * 2) % 360} 90% 78%)`,
    seed: hash
  };
}

function courseMonogram(title) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}

export { courseArt, courseMonogram };
