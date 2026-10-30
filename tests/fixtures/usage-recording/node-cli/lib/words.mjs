export function shout(word) {
  return word.toUpperCase();
}

export const countWords = (text) => text.split(" ").filter(Boolean).length;
