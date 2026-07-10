// Status id -> icon base filename, the same role `CLASS_META`'s `icon` field
// plays for classes (data/classes.js). Keys must match the closed status
// registry in shared/rules/statuses.js (`STATUSES`) — that file's `label`
// is what the icon's tooltip shows. Art lives in public/icons/statuses/
// (see that folder's README.md for the lookup order + how to swap icons).

export const STATUS_ICONS = {
  stun: "stun",
  freeze: "freeze",
  burn: "burn",
  poison: "poison",
  atk_up: "atk_up",
  spd_up: "spd_up",
  atk_down: "atk_down",
};
