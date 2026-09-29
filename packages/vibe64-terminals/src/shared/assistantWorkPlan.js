// Keep checklist recognition identical in stored progress and the plan viewer.
function parseWorkPlanLines(text) {
  let fence = "";
  return text.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return { text: line };
    }
    const item = !fence && /^\s*(?:[-*+]|\d+[.)]) \[([ xX])\] (.+)$/u.exec(line);
    return item ? { text: item[2], checked: item[1] !== " " } : { text: line };
  });
}

export { parseWorkPlanLines };
