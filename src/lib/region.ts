/**
 * US region buckets for targeting. "East Coast" includes the eastern seaboard
 * plus one tier of states inland, as requested. Regions are adjustable here.
 */
export type RegionKey = "east" | "west" | "midwest" | "central";

export const REGIONS: { key: RegionKey; label: string }[] = [
  { key: "east", label: "East Coast" },
  { key: "west", label: "West Coast" },
  { key: "midwest", label: "Midwest" },
  { key: "central", label: "Central States" },
];

export function regionLabel(key: string | null | undefined): string {
  return REGIONS.find((r) => r.key === key)?.label ?? "";
}

// State (and DC) → region. East = coastal + one state inland.
const STATE_REGION: Record<string, RegionKey> = {
  // East Coast + one inland (VT, PA, WV)
  maine: "east", "new hampshire": "east", vermont: "east", massachusetts: "east",
  "rhode island": "east", connecticut: "east", "new york": "east", "new jersey": "east",
  pennsylvania: "east", delaware: "east", maryland: "east", "district of columbia": "east",
  virginia: "east", "west virginia": "east", "north carolina": "east", "south carolina": "east",
  georgia: "east", florida: "east",
  // Midwest (Great Lakes + upper)
  ohio: "midwest", michigan: "midwest", indiana: "midwest", illinois: "midwest",
  wisconsin: "midwest", minnesota: "midwest", iowa: "midwest", missouri: "midwest",
  // Central States (plains + south-central)
  "north dakota": "central", "south dakota": "central", nebraska: "central", kansas: "central",
  oklahoma: "central", texas: "central", arkansas: "central", louisiana: "central",
  // West (mountain + Pacific, incl one inland)
  montana: "west", wyoming: "west", colorado: "west", "new mexico": "west", idaho: "west",
  utah: "west", arizona: "west", nevada: "west", washington: "west", oregon: "west",
  california: "west", alaska: "west", hawaii: "west",
};

const ABBR_REGION: Record<string, RegionKey> = {
  ME: "east", NH: "east", VT: "east", MA: "east", RI: "east", CT: "east", NY: "east", NJ: "east",
  PA: "east", DE: "east", MD: "east", DC: "east", VA: "east", WV: "east", NC: "east", SC: "east",
  GA: "east", FL: "east",
  OH: "midwest", MI: "midwest", IN: "midwest", IL: "midwest", WI: "midwest", MN: "midwest",
  IA: "midwest", MO: "midwest",
  ND: "central", SD: "central", NE: "central", KS: "central", OK: "central", TX: "central",
  AR: "central", LA: "central",
  MT: "west", WY: "west", CO: "west", NM: "west", ID: "west", UT: "west", AZ: "west", NV: "west",
  WA: "west", OR: "west", CA: "west", AK: "west", HI: "west",
};

// A few common metro-area phrasings that omit the state.
const METRO_REGION: { needle: string; region: RegionKey }[] = [
  { needle: "new york city", region: "east" }, { needle: "greater boston", region: "east" },
  { needle: "washington dc", region: "east" }, { needle: "miami", region: "east" },
  { needle: "atlanta", region: "east" }, { needle: "philadelphia", region: "east" },
  { needle: "dallas", region: "central" }, { needle: "houston", region: "central" },
  { needle: "austin", region: "central" }, { needle: "chicago", region: "midwest" },
  { needle: "detroit", region: "midwest" }, { needle: "minneapolis", region: "midwest" },
  { needle: "san francisco", region: "west" }, { needle: "los angeles", region: "west" },
  { needle: "seattle", region: "west" }, { needle: "denver", region: "west" }, { needle: "phoenix", region: "west" },
  { needle: "bay area", region: "west" }, { needle: "silicon valley", region: "west" },
];

/** Best-guess US region from a free-text location string. Null if undeterminable. */
export function regionForLocation(loc: string | null | undefined): RegionKey | null {
  if (!loc) return null;
  const s = loc.toLowerCase();
  for (const [name, region] of Object.entries(STATE_REGION)) {
    if (s.includes(name)) return region;
  }
  // 2-letter state abbreviation, comma- or space-delimited (e.g. ", TX" or " TX ").
  const m = loc.match(/(?:^|[,\s])([A-Z]{2})(?:[,\s]|$)/);
  if (m && ABBR_REGION[m[1]]) return ABBR_REGION[m[1]];
  for (const { needle, region } of METRO_REGION) {
    if (s.includes(needle)) return region;
  }
  return null;
}
