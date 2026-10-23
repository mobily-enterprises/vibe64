// QR codes for "install on my phone": a download address in, an SVG out. Shared
// by every publishing screen (server or browser; no dependencies, no DOM).
// Byte mode, versions 1-40, error correction L/M/Q/H, the standard mask choice.
// The algorithm follows the QR Code specification (ISO/IEC 18004) as in Project
// Nayuki's reference generator (MIT).

const LEVELS = Object.freeze({
  L: Object.freeze({ ordinal: 0, formatBits: 1 }),
  M: Object.freeze({ ordinal: 1, formatBits: 0 }),
  Q: Object.freeze({ ordinal: 2, formatBits: 3 }),
  H: Object.freeze({ ordinal: 3, formatBits: 2 })
});

const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];

const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function bit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function numRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    result -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version, level) {
  return Math.floor(numRawDataModules(version) / 8)
    - ECC_CODEWORDS_PER_BLOCK[level.ordinal][version] * NUM_ERROR_CORRECTION_BLOCKS[level.ordinal][version];
}

function multiply(x, y) {
  let z = 0;
  for (let index = 7; index >= 0; index -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> index) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let position = 0; position < result.length; position += 1) {
      result[position] = multiply(result[position], root);
      if (position + 1 < result.length) result[position] ^= result[position + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => { result[index] ^= multiply(coefficient, factor); });
  }
  return result;
}

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

function encodeSegments(bytes, level) {
  for (let version = 1; version <= 40; version += 1) {
    const capacityBits = numDataCodewords(version, level) * 8;
    const countBits = version < 10 ? 8 : 16;
    const usedBits = 4 + countBits + bytes.length * 8;
    if (usedBits > capacityBits) continue;
    const bits = [];
    const append = (value, length) => { for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1); };
    append(0x4, 4);
    append(bytes.length, countBits);
    for (const byte of bytes) append(byte, 8);
    append(0, Math.min(4, capacityBits - bits.length));
    append(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
    const codewords = [];
    for (let index = 0; index < bits.length; index += 8) {
      codewords.push(bits.slice(index, index + 8).reduce((value, current) => (value << 1) | current, 0));
    }
    return { version, codewords };
  }
  throw new RangeError("The text is too long for a QR code.");
}

function interleave(data, version, level) {
  const blockCount = NUM_ERROR_CORRECTION_BLOCKS[level.ordinal][version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[level.ordinal][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortLength = Math.floor(rawCodewords / blockCount);
  const divisor = reedSolomonDivisor(eccLength);
  const blocks = [];
  for (let index = 0, offset = 0; index < blockCount; index += 1) {
    const dataLength = shortLength - eccLength + (index < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + dataLength);
    offset += dataLength;
    const ecc = reedSolomonRemainder(block, divisor);
    if (index < shortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result = [];
  for (let column = 0; column < blocks[0].length; column += 1) {
    blocks.forEach((block, index) => {
      if (column !== shortLength - eccLength || index >= shortBlocks) result.push(block[column]);
    });
  }
  return result;
}

class Matrix {
  constructor(version) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, dark) {
    this.modules[y][x] = dark;
    this.reserved[y][x] = true;
  }
}

function drawFinder(matrix, x, y) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < matrix.size && yy >= 0 && yy < matrix.size) matrix.set(xx, yy, distance !== 2 && distance !== 4);
    }
  }
}

function drawFormatBits(matrix, level, mask) {
  const data = (level.formatBits << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  for (let index = 0; index <= 5; index += 1) matrix.set(8, index, bit(bits, index));
  matrix.set(8, 7, bit(bits, 6));
  matrix.set(8, 8, bit(bits, 7));
  matrix.set(7, 8, bit(bits, 8));
  for (let index = 9; index < 15; index += 1) matrix.set(14 - index, 8, bit(bits, index));
  for (let index = 0; index < 8; index += 1) matrix.set(matrix.size - 1 - index, 8, bit(bits, index));
  for (let index = 8; index < 15; index += 1) matrix.set(8, matrix.size - 15 + index, bit(bits, index));
  matrix.set(8, matrix.size - 8, true);
}

function drawVersion(matrix, version) {
  if (version < 7) return;
  let remainder = version;
  for (let index = 0; index < 12; index += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (version << 12) | remainder;
  for (let index = 0; index < 18; index += 1) {
    const dark = bit(bits, index);
    const a = matrix.size - 11 + (index % 3);
    const b = Math.floor(index / 3);
    matrix.set(a, b, dark);
    matrix.set(b, a, dark);
  }
}

function drawFunctionPatterns(matrix, version, level) {
  for (let index = 0; index < matrix.size; index += 1) {
    matrix.set(6, index, index % 2 === 0);
    matrix.set(index, 6, index % 2 === 0);
  }
  drawFinder(matrix, 3, 3);
  drawFinder(matrix, matrix.size - 4, 3);
  drawFinder(matrix, 3, matrix.size - 4);
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((x, i) => positions.forEach((y, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) matrix.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));
  drawFormatBits(matrix, level, 0);
  drawVersion(matrix, version);
}

function drawCodewords(matrix, codewords) {
  let index = 0;
  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < matrix.size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? matrix.size - 1 - vertical : vertical;
        if (!matrix.reserved[y][x] && index < codewords.length * 8) {
          matrix.modules[y][x] = bit(codewords[index >>> 3], 7 - (index & 7));
          index += 1;
        }
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

function applyMask(matrix, mask) {
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.reserved[y][x] && MASKS[mask](x, y)) matrix.modules[y][x] = !matrix.modules[y][x];
    }
  }
}

function finderPenaltyCountPatterns(history) {
  const n = history[1];
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
}

function finderPenaltyAddHistory(length, history, size) {
  history.pop();
  history.unshift(history[0] === 0 ? length + size : length);
}

function finderPenaltyTerminate(dark, length, history, size) {
  let run = length;
  if (dark) {
    finderPenaltyAddHistory(run, history, size);
    run = 0;
  }
  run += size;
  finderPenaltyAddHistory(run, history, size);
  return finderPenaltyCountPatterns(history);
}

function penaltyScore(matrix) {
  const { size, modules } = matrix;
  let result = 0;
  for (const pass of [0, 1]) {
    for (let a = 0; a < size; a += 1) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b += 1) {
        const value = pass === 0 ? modules[a][b] : modules[b][a];
        if (value === color) {
          run += 1;
          if (run === 5) result += PENALTY_N1;
          else if (run > 5) result += 1;
        } else {
          finderPenaltyAddHistory(run, history, size);
          if (!color) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
          color = value;
          run = 1;
        }
      }
      result += finderPenaltyTerminate(color, run, history, size) * PENALTY_N3;
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) result += PENALTY_N2;
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

// The module matrix (true = dark) for `text` (UTF-8, byte mode).
function qrMatrix(text, { level = "M" } = {}) {
  const ecl = LEVELS[level];
  if (!ecl) throw new RangeError("QR error correction is L, M, Q or H.");
  const bytes = [...new TextEncoder().encode(String(text))];
  const { version, codewords } = encodeSegments(bytes, ecl);
  const all = interleave(codewords, version, ecl);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = new Matrix(version);
    drawFunctionPatterns(matrix, version, ecl);
    drawCodewords(matrix, all);
    applyMask(matrix, mask);
    drawFormatBits(matrix, ecl, mask);
    const score = penaltyScore(matrix);
    if (!best || score < best.score) best = { matrix, score, mask };
  }
  return { version, mask: best.mask, size: best.matrix.size, modules: best.matrix.modules };
}

function escapeAttribute(value) {
  return String(value).replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
}

// A crisp, scalable SVG: one path, a quiet zone of `margin` modules, colours
// as given (defaults follow the surrounding text colour on a white tile, so it
// stays scannable in dark themes).
function qrSvg(text, { level = "M", margin = 4, dark = "#000000", light = "#ffffff", title = "" } = {}) {
  const { size, modules } = qrMatrix(text, { level });
  const extent = size + margin * 2;
  const parts = [];
  modules.forEach((row, y) => row.forEach((value, x) => {
    if (value) parts.push(`M${x + margin},${y + margin}h1v1h-1z`);
  }));
  const label = title ? `<title>${escapeAttribute(title)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges" role="img"${title ? ` aria-label="${escapeAttribute(title)}"` : ""}>${label}<rect width="100%" height="100%" fill="${escapeAttribute(light)}"/><path d="${parts.join("")}" fill="${escapeAttribute(dark)}"/></svg>`;
}

export { qrMatrix, qrSvg };
