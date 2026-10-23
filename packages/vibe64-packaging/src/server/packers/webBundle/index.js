import { notImplemented } from "../../notImplemented.js";

const webBundlePacker = Object.freeze({
  id: "web-bundle",
  label: "Static web bundle",
  produces: Object.freeze(["static client build"]),
  implemented: false,
  buildRecipe: notImplemented("packer", "web-bundle", "build")
});

export { webBundlePacker };
