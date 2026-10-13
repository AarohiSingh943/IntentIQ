import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Three cartographic moods rendered from the same OpenFreeMap vector tiles (OpenMapTiles schema,
 * OpenStreetMap data) plus AWS Terrarium elevation for relief. Buildings extrude with real heights.
 */
export type StyleKey = "night" | "dawn" | "blueprint";

export interface Palette {
  key: StyleKey;
  label: string;
  theme: "dark" | "light";
  background: string;
  landcover: string;
  residential: string;
  commercial: string;
  industrial: string;
  institutional: string;
  green: string;
  park: string;
  parkOutline: string;
  water: string;
  waterway: string;
  aeroway: string;
  rail: string;
  path: string;
  minor: string;
  secondary: string;
  primary: string;
  motorway: string;
  buildingFlat: string;
  building: [string, string, string, string];
  boundary: string;
  roadLabel: string;
  waterLabel: string;
  placeLabel: string;
  cityLabel: string;
  halo: string;
  hillshadeShadow: string;
  hillshadeHighlight: string;
  sky: string;
  horizon: string;
  fog: string;
  routeCore: string;
  routeGlow: string;
  routeDash: string;
  heat: [string, string, string, string];
  lightIntensity: number;
}

export const PALETTES: Record<StyleKey, Palette> = {
  night: {
    key: "night",
    label: "Night",
    theme: "dark",
    background: "#0b0e14",
    landcover: "#0f1712",
    residential: "#0e111a",
    commercial: "#12131c",
    industrial: "#0f1015",
    institutional: "#111520",
    green: "#0f1913",
    park: "#0f1b15",
    parkOutline: "#1a3025",
    water: "#0a1827",
    waterway: "#10263b",
    aeroway: "#1a1e2a",
    rail: "#232838",
    path: "#1b2130",
    minor: "#1a1f2c",
    secondary: "#242a3a",
    primary: "#2d3446",
    motorway: "#3a3f52",
    buildingFlat: "#141821",
    building: ["#161a24", "#1e2432", "#2a3144", "#3b4358"],
    boundary: "#2a2f3f",
    roadLabel: "#6c7386",
    waterLabel: "#2f5c7a",
    placeLabel: "#7f879c",
    cityLabel: "#b8bdcc",
    halo: "#0b0e14",
    hillshadeShadow: "#05070b",
    hillshadeHighlight: "#2a3142",
    sky: "#0b0e14",
    horizon: "#151b28",
    fog: "#0b0e14",
    routeCore: "#d3b47a",
    routeGlow: "#d3b47a",
    routeDash: "#9fd0e3",
    heat: ["rgba(34,60,78,0.32)", "rgba(66,114,142,0.5)", "rgba(159,208,227,0.62)", "rgba(211,180,122,0.8)"],
    lightIntensity: 0.32,
  },
  dawn: {
    key: "dawn",
    label: "Dawn",
    theme: "light",
    background: "#f1ece2",
    landcover: "#dfe6d0",
    residential: "#efe9dd",
    commercial: "#ece3d3",
    industrial: "#e7e2d8",
    institutional: "#ebe4d6",
    green: "#d9e5c8",
    park: "#d3e2c2",
    parkOutline: "#b8cba4",
    water: "#bcd6e4",
    waterway: "#a9c8da",
    aeroway: "#e0dacd",
    rail: "#cfc6b6",
    path: "#d8cfbe",
    minor: "#ffffff",
    secondary: "#fff9ee",
    primary: "#fbeccb",
    motorway: "#f6d9a6",
    buildingFlat: "#e2dacb",
    building: ["#e6dfd0", "#d9d0bf", "#c9bfab", "#b4a992"],
    boundary: "#bfb4a0",
    roadLabel: "#6f665a",
    waterLabel: "#5b8aa6",
    placeLabel: "#5c5348",
    cityLabel: "#2f2a24",
    halo: "#f4f0e7",
    hillshadeShadow: "#b8ad98",
    hillshadeHighlight: "#ffffff",
    sky: "#cfe0ee",
    horizon: "#f6e4cf",
    fog: "#eee7da",
    routeCore: "#a8771f",
    routeGlow: "#d3a24a",
    routeDash: "#1f6f8f",
    heat: ["rgba(120,150,170,0.25)", "rgba(80,130,160,0.4)", "rgba(40,110,150,0.5)", "rgba(168,119,31,0.7)"],
    lightIntensity: 0.5,
  },
  blueprint: {
    key: "blueprint",
    label: "Blueprint",
    theme: "dark",
    background: "#081527",
    landcover: "#0a1a2f",
    residential: "#0a182b",
    commercial: "#0b1a2f",
    industrial: "#091628",
    institutional: "#0b1b31",
    green: "#0b1c2f",
    park: "#0c1f33",
    parkOutline: "#1f4a6b",
    water: "#050e1c",
    waterway: "#173c5a",
    aeroway: "#1a3c5c",
    rail: "#1f4a6b",
    path: "#1b4463",
    minor: "#1d4b70",
    secondary: "#28628f",
    primary: "#3579ad",
    motorway: "#4d92c8",
    buildingFlat: "#0e2340",
    building: ["#10294d", "#153662", "#1c4a83", "#2a64a8"],
    boundary: "#2f6d9a",
    roadLabel: "#6faed8",
    waterLabel: "#3f7ba5",
    placeLabel: "#8fc7ec",
    cityLabel: "#d6ecff",
    halo: "#081527",
    hillshadeShadow: "#03080f",
    hillshadeHighlight: "#1f4d78",
    sky: "#081527",
    horizon: "#123156",
    fog: "#081527",
    routeCore: "#ffd166",
    routeGlow: "#ffb703",
    routeDash: "#ffffff",
    heat: ["rgba(31,77,120,0.35)", "rgba(53,121,173,0.5)", "rgba(111,174,216,0.6)", "rgba(255,209,102,0.8)"],
    lightIntensity: 0.4,
  },
};

const OFM_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>';
const TERRAIN_ATTRIBUTION = 'Terrain <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen/AWS</a>';

export function buildStyle(p: Palette): StyleSpecification {
  const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name"]];
  return {
    version: 8,
    name: `Intentra ${p.label}`,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    projection: { type: "globe" },
    sources: {
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: OFM_ATTRIBUTION },
      terrain: {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 14,
        attribution: TERRAIN_ATTRIBUTION,
      },
    },
    sky: {
      "sky-color": p.sky,
      "horizon-color": p.horizon,
      "fog-color": p.fog,
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.8,
      "fog-ground-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0],
    },
    light: { anchor: "viewport", color: "#fff5e0", intensity: p.lightIntensity, position: [1.15, 200, 35] },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.background } },
      {
        id: "landcover",
        type: "fill",
        source: "ofm",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland", "wetland"]]],
        paint: { "fill-color": p.landcover, "fill-opacity": 0.7 },
      },
      {
        id: "landuse",
        type: "fill",
        source: "ofm",
        "source-layer": "landuse",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ["residential", "suburb", "neighbourhood"],
            p.residential,
            ["commercial", "retail"],
            p.commercial,
            ["industrial", "railway"],
            p.industrial,
            ["hospital", "school", "college", "university"],
            p.institutional,
            ["cemetery", "grass", "park", "pitch", "playground", "garden"],
            p.green,
            p.residential,
          ],
          "fill-opacity": 0.9,
        },
      },
      { id: "park", type: "fill", source: "ofm", "source-layer": "park", paint: { "fill-color": p.park, "fill-opacity": 0.85 } },
      { id: "park-outline", type: "line", source: "ofm", "source-layer": "park", minzoom: 13, paint: { "line-color": p.parkOutline, "line-width": 0.8, "line-opacity": 0.8 } },
      { id: "hillshade", type: "hillshade", source: "terrain", minzoom: 4, maxzoom: 16, paint: { "hillshade-shadow-color": p.hillshadeShadow, "hillshade-highlight-color": p.hillshadeHighlight, "hillshade-accent-color": p.hillshadeShadow, "hillshade-exaggeration": 0.35, "hillshade-illumination-anchor": "map" } },
      { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": p.water } },
      { id: "waterway", type: "line", source: "ofm", "source-layer": "waterway", paint: { "line-color": p.waterway, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 2.2] } },
      { id: "aeroway", type: "line", source: "ofm", "source-layer": "aeroway", minzoom: 11, paint: { "line-color": p.aeroway, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 8] } },
      {
        id: "rail",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "rail"],
        minzoom: 11,
        paint: { "line-color": p.rail, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 1.6], "line-dasharray": [4, 3] },
      },
      {
        id: "road-path",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["path", "track", "pedestrian"]]],
        minzoom: 14,
        paint: { "line-color": p.path, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 18, 2.4], "line-dasharray": [2, 2] },
      },
      {
        id: "road-minor",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "living_street"]]],
        minzoom: 12,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.minor, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 12, 0.5, 15, 1.6, 18, 7] },
      },
      {
        id: "road-secondary",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]],
        minzoom: 10,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.secondary, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 10, 0.6, 15, 2.6, 18, 12] },
      },
      {
        id: "road-primary",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["primary", "trunk"]]],
        minzoom: 7,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.primary, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 7, 0.5, 15, 3.6, 18, 16] },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "motorway"],
        minzoom: 5,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.motorway, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 5, 0.6, 15, 4.5, 18, 20] },
      },
      {
        id: "building-flat",
        type: "fill",
        source: "ofm",
        "source-layer": "building",
        maxzoom: 14.5,
        minzoom: 12,
        paint: { "fill-color": p.buildingFlat, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 14.5, 0.9] },
      },
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "ofm",
        "source-layer": "building",
        minzoom: 14,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, p.building[0], 25, p.building[1], 80, p.building[2], 200, p.building[3]],
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.6, ["coalesce", ["get", "render_height"], 6]],
          "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.6, ["coalesce", ["get", "render_min_height"], 0]],
          "fill-extrusion-opacity": 0.92,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      {
        id: "boundary",
        type: "line",
        source: "ofm",
        "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 4],
        paint: { "line-color": p.boundary, "line-width": 1, "line-dasharray": [3, 2] },
      },
      {
        id: "road-name",
        type: "symbol",
        source: "ofm",
        "source-layer": "transportation_name",
        minzoom: 14.5,
        layout: {
          "symbol-placement": "line",
          "text-field": name,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 10, 18, 13],
          "text-letter-spacing": 0.04,
          "symbol-spacing": 320,
        },
        paint: { "text-color": p.roadLabel, "text-halo-color": p.halo, "text-halo-width": 1.2 },
      },
      {
        id: "water-name",
        type: "symbol",
        source: "ofm",
        "source-layer": "water_name",
        layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 11, "symbol-placement": "line" },
        paint: { "text-color": p.waterLabel, "text-halo-color": p.water, "text-halo-width": 1 },
      },
      {
        id: "place-neighbourhood",
        type: "symbol",
        source: "ofm",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter", "village", "hamlet"]]],
        minzoom: 12,
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10.5, 16, 13], "text-letter-spacing": 0.12 },
        paint: { "text-color": p.placeLabel, "text-halo-color": p.halo, "text-halo-width": 1.4, "text-opacity": 0.9 },
      },
      {
        id: "place-city",
        type: "symbol",
        source: "ofm",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        maxzoom: 14,
        layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 6, 11, 12, 16], "text-letter-spacing": 0.06 },
        paint: { "text-color": p.cityLabel, "text-halo-color": p.halo, "text-halo-width": 1.6 },
      },
      {
        id: "place-country",
        type: "symbol",
        source: "ofm",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "country"],
        maxzoom: 7,
        layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 5, 14], "text-letter-spacing": 0.2, "text-transform": "uppercase" },
        paint: { "text-color": p.cityLabel, "text-halo-color": p.halo, "text-halo-width": 1.4, "text-opacity": 0.85 },
      },
    ],
  };
}
