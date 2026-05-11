function shellScript(lines) {
  return lines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join(";\n");
}

export {
  shellScript
};
