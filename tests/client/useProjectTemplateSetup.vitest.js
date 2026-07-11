import { describe, expect, it } from "vitest";
import { effectScope, reactive } from "vue";
import { mdiRocketLaunchOutline, mdiWeb } from "@mdi/js";

import {
  useProjectTemplateSetup
} from "../../src/composables/useProjectTemplateSetup.js";

describe("useProjectTemplateSetup", () => {
  it("selects one template, emits apply, and disables changes while applying", () => {
    const props = reactive({
      applyingTemplateId: "",
      templates: [
        {
          icon: "web",
          id: "jskit-public",
          name: "Public"
        },
        {
          icon: "unknown",
          id: "jskit-example",
          name: "Example"
        }
      ]
    });
    const emitted = [];
    const scope = effectScope();
    let setup;
    scope.run(() => {
      setup = useProjectTemplateSetup(props, (event, payload) => emitted.push({
        event,
        payload
      }));
    });

    expect(setup.selectedTemplate.value).toBeNull();
    expect(setup.templateIcon(props.templates[0])).toBe(mdiWeb);
    expect(setup.templateIcon(props.templates[1])).toBe(mdiRocketLaunchOutline);

    setup.selectTemplate(props.templates[0]);
    expect(setup.selectedTemplate.value?.id).toBe("jskit-public");
    setup.applySelectedTemplate();
    expect(emitted).toEqual([
      {
        event: "apply",
        payload: "jskit-public"
      }
    ]);

    props.applyingTemplateId = "jskit-public";
    setup.selectTemplate(props.templates[1]);
    setup.openAdvancedSetup();
    expect(setup.selectedTemplate.value?.id).toBe("jskit-public");
    expect(emitted).toHaveLength(1);

    props.applyingTemplateId = "";
    setup.openAdvancedSetup();
    expect(emitted.at(-1)).toEqual({
      event: "advanced",
      payload: undefined
    });

    scope.stop();
  });
});
