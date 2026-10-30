// A small command for the Node.js usage recorder tests: it runs a few project
// functions and exits normally, so its run is flushed on exit.
import { countWords, shout } from "./lib/words.mjs";

const words = ["one", "two", "three"];
for (const word of words) process.stdout.write(`${shout(word)}\n`);
process.stdout.write(`${countWords(words.join(" "))}\n`);
