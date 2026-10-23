import { notImplemented } from "../../notImplemented.js";

const pythonDistPacker = Object.freeze({
  id: "python-dist",
  label: "Python distributions",
  produces: Object.freeze(["sdist", "wheel"]),
  implemented: false,
  buildRecipe: notImplemented("packer", "python-dist", "build")
});

export { pythonDistPacker };
