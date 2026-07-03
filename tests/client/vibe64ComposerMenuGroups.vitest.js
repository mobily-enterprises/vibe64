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
                    label: "porcoddio",
                    navigable: true
                  }
                ],
                items: [],
                key: "a\u001fb\u001fc",
                label: "c",
                navigable: true
              }
            ],
            items: [],
            key: "a\u001fb",
            label: "b",
            navigable: true
          }
        ],
        items: [],
        key: "a",
        label: "a",
        navigable: false
      }
    ]);
  });

  it("keeps top-level groups as headings and nested paths as prompt groups", () => {
    expect(composerMenuGroupsForItems([
      {
        group: "Git",
        id: "sync",
        label: "Sync code with GitHub"
      },
      {
        group: "Code",
        groupPath: ["Code", "Deslop"],
        id: "deslop_changes",
        label: "Only changes"
      },
      {
        group: "Code",
        groupPath: ["Code", "Deslop"],
        id: "deslop_codebase",
        label: "Whole codebase"
      },
      {
        group: "Code",
        groupPath: ["Code", "Check UI"],
        id: "check_ui_changes",
        label: "Only changes"
      },
      {
        group: "Info",
        id: "create_handover",
        label: "Create handover"
      }
    ])).toMatchObject([
      {
        groups: [],
        items: [
          {
            id: "sync",
            label: "Sync code with GitHub"
          }
        ],
        label: "Git",
        navigable: false
      },
      {
        groups: [
          {
            items: [
              {
                id: "deslop_changes",
                label: "Only changes"
              },
              {
                id: "deslop_codebase",
                label: "Whole codebase"
              }
            ],
            label: "Deslop",
            navigable: true
          },
          {
            items: [
              {
                id: "check_ui_changes",
                label: "Only changes"
              }
            ],
            label: "Check UI",
            navigable: true
          }
        ],
        label: "Code",
        navigable: false
      },
      {
        groups: [],
        items: [
          {
            id: "create_handover",
            label: "Create handover"
          }
        ],
        label: "Info",
        navigable: false
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
        label: "Git",
        navigable: false
      }
    ]);
  });
});
