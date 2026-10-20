export function send(svg) { return svg.querySelector("#packet").animate([{ transform: "translateX(0px)" }, { transform: "translateX(40px)" }], { duration: 300 }).finished; }
