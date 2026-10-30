const counters = new Map();

export function info(label) {
  counters.set(label, (counters.get(label) || 0) + 1);
}
