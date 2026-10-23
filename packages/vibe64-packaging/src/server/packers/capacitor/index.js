import { notImplemented } from "../../notImplemented.js";

const capacitorPacker = Object.freeze({
  id: "capacitor",
  label: "Mobile app",
  produces: Object.freeze(["Android APK"]),
  implemented: false,
  buildRecipe: notImplemented("packer", "capacitor", "build")
});

export { capacitorPacker };
