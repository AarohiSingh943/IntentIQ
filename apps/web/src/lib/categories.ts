/** Visual identity for every place category: a family, a colour and a glyph. */

export type Family = "food" | "cafe" | "drink" | "nature" | "culture" | "active" | "focus";

export const FAMILY_COLOR: Record<Family, string> = {
  food: "#f08a6c",
  cafe: "#d3b47a",
  drink: "#b48cf2",
  nature: "#8fbf9f",
  culture: "#9fd0e3",
  active: "#f2c14e",
  focus: "#c9d1e6",
};

const FAMILY_OF: Record<string, Family> = {
  restaurant: "food",
  fast_food: "food",
  food_court: "food",
  market: "food",
  cafe: "cafe",
  ice_cream: "cafe",
  dessert: "cafe",
  bar: "drink",
  nightclub: "drink",
  park: "nature",
  nature: "nature",
  viewpoint: "nature",
  playground: "nature",
  zoo: "nature",
  museum: "culture",
  attraction: "culture",
  monument: "culture",
  theatre: "culture",
  cinema: "culture",
  bookshop: "culture",
  mall: "culture",
  gym: "active",
  swimming: "active",
  spa: "active",
  arcade: "active",
  library: "focus",
  coworking: "focus",
};

// 24x24 stroke glyphs, kept deliberately simple so they read at 14px.
const GLYPH: Record<Family, string> = {
  food: "M7 3v8a2 2 0 0 0 2 2v8M9 3v6M11 3v6M17 3c-2 0-3 3-3 6v3h3v9",
  cafe: "M4 8h11v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM15 9h2a2.5 2.5 0 0 1 0 5h-2M6 21h8",
  drink: "M6 4h12l-5 8v6h3v2H8v-2h3v-6zM8 8h8",
  nature: "M12 3l6 8h-3l4 6h-5v4h-4v-4H5l4-6H6z",
  culture: "M4 9l8-5 8 5H4zM6 9v9M10 9v9M14 9v9M18 9v9M4 18h16v2H4z",
  active: "M13 2L5 13h5l-1 9 8-11h-5z",
  focus: "M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z",
};

export function familyOf(category: string): Family {
  return FAMILY_OF[category] ?? "culture";
}

export function colorOf(category: string): string {
  return FAMILY_COLOR[familyOf(category)];
}

export function glyphOf(category: string): string {
  return GLYPH[familyOf(category)];
}

export function glyphSvg(category: string, size = 14, stroke = "currentColor"): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${glyphOf(category)}"/></svg>`;
}

/** A MapLibre `match` expression that colours features by their category property. */
export function categoryColorExpression(property = "category"): unknown[] {
  const pairs: unknown[] = [];
  for (const [category, family] of Object.entries(FAMILY_OF)) pairs.push(category, FAMILY_COLOR[family]);
  return ["match", ["get", property], ...pairs, FAMILY_COLOR.culture];
}
