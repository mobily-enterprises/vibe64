# Build outputs and download results

Use **Preview** to select a declared output target. A project can offer a web app,
an interactive terminal or a finite build with downloadable results. On mobile,
use **Show project** and **Show preview controls** to reveal the output controls.

Choose the intended target and use its offered run/build control. If **Preview
options** opens, fill its required fields and choose **Run**. Wait for the build
result rather than treating accepted work as a finished artifact. **Show run output**
reveals its logs; hiding that terminal does not stop the command.

The output controls expose the named downloadable results after a successful build.
Use the offered download control for the exact result and finish any browser
download/save interaction. The result comes from the completed build snapshot,
not a live source path. A different successful build can produce a different result;
check its name and originating target before sharing it.

If a build fails, inspect its output and prerequisites before retrying. No offered
result can mean the target declares none or the build has not produced it yet.
An offered link is not proof your browser saved a file. Do not infer a completed
download from a successful build alone.

Colleague can explain outputs, inspect their bounded status/logs, and run supported
requested targets through the native controls. It can open Preview and identify
an observed result; the person completes browser save prompts. When an exact
download handoff is not exposed to Colleague, it must say so and explain the real
UI step. Ask it to delegate a build failure to a coding conversation when source
investigation is needed. A how-to question does not authorize starting a build.
