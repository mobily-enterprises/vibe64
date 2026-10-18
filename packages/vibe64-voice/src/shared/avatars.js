// The avatar artwork catalogue: stable saved IDs, chooser labels and the
// artwork each assistant target shows before a person chooses.
const VIBE64_AVATAR_CHOICES = Object.freeze([
  Object.freeze({ id: "merc", label: "Merc · male" }),
  Object.freeze({ id: "yu", label: "Yu · female" })
]);
const VIBE64_AVATAR_IDS = Object.freeze(VIBE64_AVATAR_CHOICES.map(choice => choice.id));
const VIBE64_DEFAULT_AVATARS = Object.freeze({ colleague: "merc", coding: "yu" });

function isVibe64AvatarId(value) {
  return VIBE64_AVATAR_IDS.includes(value);
}

export { VIBE64_AVATAR_CHOICES, VIBE64_AVATAR_IDS, VIBE64_DEFAULT_AVATARS, isVibe64AvatarId };
