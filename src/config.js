// Central knobs. Faction colors here MUST mirror --a / --b in styles/base.css
// (JS needs the literal values for inline SVG fills).

export const COLORS = {
  factionA: "#38bdf8", // matches --a
  factionB: "#fb7185", // matches --b
  clash: "#fbbf24",    // matches --clash
};

export const accentFor = (side) => (side === "a" ? COLORS.factionA : COLORS.factionB);

// Cutscene timeline (ms). The CSS keyframes in styles/cutscene.css are authored
// against a 2.1s timeline with impact at ~66%; keep these in sync if you retime.
export const CUTSCENE = {
  total: 2250,
  impact: 1500,
};
