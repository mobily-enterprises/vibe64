import { notImplemented } from "../../notImplemented.js";

const npmPacker = Object.freeze({
  id: "npm",
  label: "npm package",
  produces: Object.freeze(["npm tarball"]),
  implemented: false,
  buildRecipe: notImplemented("packer", "npm", "build")
});

export { npmPacker };
