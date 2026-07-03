import { describe, expect, it } from "vitest";

import {
  composerMenuGroupsForItems,
  composerMenuItemGroupPath
} from "../../src/lib/vibe64ComposerMenuGroups.js";

describe("vibe64ComposerMenuGroups", () => {
  it("uses adapter-provided groupPath without imposing a depth limit", () => {
    const groups = composerMenuGroupsForItems([
      {
        groupPath: ["a", "b", "c", "porcoddio"],
        id: "adapter.deep_prompt",
        label: "Deep prompt"
      }
    ]);

    expect(composerMenuItemGroupPath({
      groupPath: ["a", "b", "c", "porcoddio"]
    })).toEqual(["a", "b", "c", "porcoddio"]);
    expect(groups).toEqual([
      {
        groups: [
          {
            groups: [
              {
                groups: [
                  {
                    groups: [],
                    items: [
                      {
                        groupPath: ["a", "b", "c", "porcoddio"],
                        id: "adapter.deep_prompt",
                        label: "Deep prompt"
                      }
                    ],
                    key: "a\u001fb\u001fc\u001fporcoddio",
                    label: "porcoddio"
                  }
                ],
                items: [],
                key: "a\u001fb\u001fc",
                label: "c"
              }
            ],
            items: [],
            key: "a\u001fb",
            label: "b"
          }
        ],
        items: [],
        key: "a",
        label: "a"
      }
    ]);
  });

  it("keeps old flat group values working", () => {
    expect(composerMenuGroupsForItems([
      {
        group: "Git",
        id: "sync",
        label: "Sync"
      }
    ])).toMatchObject([
      {
        groups: [],
        items: [
          {
            group: "Git",
            id: "sync",
            label: "Sync"
          }
        ],
        label: "Git"
      }
    ]);
  });
});
