// Keep checklist recognition identical in stored progress and the plan viewer.
function parseWorkPlanLines(text, { markTechnicalDetails = false } = {}) {
  let fence = "";
  return text.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return { text: line };
    }
    const item = !fence && /^\s*(?:[-*+]|\d+[.)]) \[([ xX])\] (.+)$/u.exec(line);
    return item ? { text: item[2], checked: item[1] !== " " } : {
      text: line,
      ...(markTechnicalDetails && !fence && /^## Technical details\s*$/iu.test(line) ? { technicalDetails: true } : {})
    };
  });
}

// Compare the agreed content while allowing checklist progress and completion.
function workPlanScope(text) {
  const lines = text.replace(/^Status: completed\r?$/mu, "Status: active").split("\n");
  return parseWorkPlanLines(lines.join("\n")).map((item, index) => item.checked === undefined
    ? lines[index]
    : lines[index].replace(/^(\s*(?:[-*+]|\d+[.)]) \[)[ xX]/u, "$1 ")
  ).join("\n");
}

export { parseWorkPlanLines, workPlanScope };
