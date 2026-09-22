import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE } from "../../../../common/server/config";
import type { ImageHit, ImageProvider } from "./types";

/**
 * Brand marks are a different problem from photographs. "Google" does not want a
 * photo of a sign; it wants the logo, in the brand's own colour, on a clean plate.
 * Simple Icons publishes exactly that for ~3.4k brands under CC0, keyed by slug,
 * with no API key and a CDN that answers `404` for anything it does not have.
 */
export type Brand = { title: string; slug: string; hex: string; aliases: string[] };

const INDEX_URL = "https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json";
const CACHE_FILE = path.join(WORKSPACE, "cache", "brands.json");
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Recognising a brand *name inside a sentence* has to work before any network
 * call, because that decision drives which sentences get an overlay at all. This
 * seed covers the names that actually turn up in the kind of video this tool cuts;
 * the full index is folded in on the first successful fetch.
 */
const SEED: Array<[string, string, string, ...string[]]> = [
  ["Google", "google", "4285F4"], ["Facebook", "facebook", "0866FF"], ["Meta", "meta", "0467DF"],
  ["Instagram", "instagram", "FF0069"], ["WhatsApp", "whatsapp", "25D366"], ["X", "x", "000000", "Twitter"],
  ["TikTok", "tiktok", "000000"], ["YouTube", "youtube", "FF0000"], ["LinkedIn", "linkedin", "0A66C2"],
  ["Reddit", "reddit", "FF4500"], ["Snapchat", "snapchat", "FFFC00"], ["Pinterest", "pinterest", "BD081C"],
  ["Apple", "apple", "000000"], ["Microsoft", "microsoft", "5E5E5E"], ["Amazon", "amazon", "FF9900"],
  ["Netflix", "netflix", "E50914"], ["Spotify", "spotify", "1DB954"], ["Tesla", "tesla", "CC0000"],
  ["Nvidia", "nvidia", "76B900"], ["Intel", "intel", "0071C5"], ["AMD", "amd", "ED1C24"],
  ["Samsung", "samsung", "1428A0"], ["Sony", "sony", "FFFFFF"], ["Nintendo", "nintendo", "E60012"],
  ["OpenAI", "openai", "412991", "ChatGPT", "GPT"], ["Anthropic", "anthropic", "191919"],
  ["Claude", "claude", "D97757"], ["Perplexity", "perplexity", "1FB8CD"], ["Hugging Face", "huggingface", "FFD21E"],
  ["GitHub", "github", "181717"], ["GitLab", "gitlab", "FC6D26"], ["Git", "git", "F05032"],
  ["Stack Overflow", "stackoverflow", "F58025"], ["Docker", "docker", "2496ED"], ["Kubernetes", "kubernetes", "326CE5"],
  ["Linux", "linux", "FCC624"], ["Ubuntu", "ubuntu", "E95420"], ["Debian", "debian", "A81D33"],
  ["Python", "python", "3776AB"], ["JavaScript", "javascript", "F7DF1E"], ["TypeScript", "typescript", "3178C6"],
  ["React", "react", "61DAFB"], ["Next.js", "nextdotjs", "000000", "NextJS"], ["Node.js", "nodedotjs", "5FA04E", "Node"],
  ["Rust", "rust", "000000"], ["Go", "go", "00ADD8", "Golang"], ["Swift", "swift", "F05138"],
  ["Vercel", "vercel", "000000"], ["Netlify", "netlify", "00C7B7"], ["Cloudflare", "cloudflare", "F38020"],
  ["Amazon Web Services", "amazonwebservices", "232F3E", "AWS"], ["Firebase", "firebase", "DD2C00"],
  ["Supabase", "supabase", "3FCF8E"], ["PostgreSQL", "postgresql", "4169E1", "Postgres"], ["MySQL", "mysql", "4479A1"],
  ["MongoDB", "mongodb", "47A248"], ["Redis", "redis", "FF4438"], ["SQLite", "sqlite", "003B57"],
  ["Slack", "slack", "4A154B"], ["Discord", "discord", "5865F2"], ["Telegram", "telegram", "26A5E4"],
  ["Zoom", "zoom", "0B5CFF"], ["Notion", "notion", "000000"], ["Figma", "figma", "F24E1E"],
  ["Linear", "linear", "5E6AD2"], ["Jira", "jira", "0052CC"], ["Trello", "trello", "0052CC"],
  ["Stripe", "stripe", "635BFF"], ["PayPal", "paypal", "003087"], ["Visa", "visa", "1A1F71"],
  ["Mastercard", "mastercard", "EB001B"], ["Shopify", "shopify", "7AB55C"], ["Coinbase", "coinbase", "0052FF"],
  ["Bitcoin", "bitcoin", "F7931A"], ["Ethereum", "ethereum", "3C3C3D"], ["Uber", "uber", "000000"],
  ["Airbnb", "airbnb", "FF5A5F"], ["Spotify", "spotify", "1DB954"], ["Twitch", "twitch", "9146FF"],
  ["Steam", "steam", "000000"], ["Epic Games", "epicgames", "313131"], ["Unity", "unity", "FFFFFF"],
  ["Unreal Engine", "unrealengine", "0E1128"], ["Blender", "blender", "E87D0D"], ["Adobe", "adobe", "FF0000"],
  ["Photoshop", "adobephotoshop", "31A8FF"], ["Premiere Pro", "adobepremierepro", "9999FF"],
  ["DaVinci Resolve", "davinciresolve", "233A51"], ["Canva", "canva", "00C4CC"], ["Dropbox", "dropbox", "0061FF"],
  ["Gmail", "gmail", "EA4335"], ["Google Drive", "googledrive", "4285F4"], ["Google Chrome", "googlechrome", "4285F4", "Chrome"],
  ["Safari", "safari", "006CFF"], ["Firefox", "firefoxbrowser", "FF7139"], ["Arc", "arc", "1ABCFE"],
  ["Visual Studio Code", "vscodium", "2F80ED", "VS Code", "VSCode"], ["JetBrains", "jetbrains", "000000"],
  ["Vim", "vim", "019733"], ["Obsidian", "obsidian", "7C3AED"], ["Raycast", "raycast", "FF6363"],
  ["Proxmox", "proxmox", "E57000"], ["Raspberry Pi", "raspberrypi", "A22846"], ["Arduino", "arduino", "00878F"],
  ["Home Assistant", "homeassistant", "18BCF2"], ["Plex", "plex", "EBAF00"], ["Sonos", "sonos", "000000"],
  ["Ikea", "ikea", "0058A3"], ["McDonald's", "mcdonalds", "FBC817"], ["Starbucks", "starbucks", "006241"],
  ["Nike", "nike", "111111"], ["Adidas", "adidas", "000000"], ["Coca-Cola", "cocacola", "F40009", "Coke"],
  ["Pepsi", "pepsi", "0E5FAF"], ["Red Bull", "redbull", "001E3C"], ["BMW", "bmw", "0066B1"],
  ["Mercedes", "mercedes", "000000"], ["Toyota", "toyota", "EB0A1E"], ["Ford", "ford", "00274E"],
  ["Volkswagen", "volkswagen", "151F5D"], ["Porsche", "porsche", "B12B28"], ["Ferrari", "ferrari", "DF0000"],
];

function seedBrands(): Brand[] {
  return SEED.map(([title, slug, hex, ...aliases]) => ({ title, slug, hex, aliases }));
}

type RawIcon = { title?: string; slug?: string; hex?: string; aliases?: { aka?: string[]; old?: string[] } };

/** Matching ignores everything a brand name can be written with: case, spaces, dots, dashes, accents. */
export const brandKey = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

let cached: Promise<Brand[]> | null = null;

async function readCache(): Promise<{ brands: Brand[]; fresh: boolean } | null> {
  try {
    const stat = await fs.stat(CACHE_FILE);
    const parsed = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return { brands: parsed as Brand[], fresh: Date.now() - stat.mtimeMs <= CACHE_TTL_MS };
  } catch {
    return null;
  }
}

/** After a failed fetch, how long to run on what we have before trying the network again. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
let retryAt = 0;

async function fetchIndex(): Promise<Brand[]> {
  const res = await fetch(INDEX_URL, { headers: { "User-Agent": "agentcut/0.1 (local clip tool)" } });
  if (!res.ok) throw new Error(`simple-icons index ${res.status}`);
  const raw = (await res.json()) as RawIcon[];
  const brands = raw.flatMap((icon): Brand[] =>
    icon.title && icon.slug
      ? [{ title: icon.title, slug: icon.slug, hex: icon.hex ?? "000000", aliases: [...(icon.aliases?.aka ?? []), ...(icon.aliases?.old ?? [])] }]
      : [],
  );
  if (!brands.length) throw new Error("simple-icons index was empty");
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(brands));
  return brands;
}

/**
 * The seeded names are always available, so an offline machine still recognises
 * "Google" in a sentence and still plans the overlay. Only the picture needs the
 * network, and a picture that cannot be fetched is dropped by the caller.
 */
export function brandIndex(): Promise<Brand[]> {
  cached ??= (async () => {
    const seeds = seedBrands();
    const onDisk = await readCache();
    // A fresh cache is the answer. Otherwise try the network once, and on failure run
    // on the stale cache (or the seeds) for a while rather than retrying on every
    // sentence: planning is documented as needing no network, and an offline machine
    // must not turn a 300-sentence transcript into 300 connection timeouts.
    let loaded = onDisk?.fresh ? onDisk.brands : null;
    if (!loaded && Date.now() >= retryAt) {
      loaded = await fetchIndex().catch(() => null);
      if (!loaded) retryAt = Date.now() + RETRY_AFTER_MS;
    }
    loaded ??= onDisk?.brands ?? null;
    if (!loaded) {
      // Seeds only, and remembered as such: the next call after the retry window
      // will look again, but every call inside it will not.
      setTimeout(() => { if (cached === seedsPromise) { cached = null; table = null; } }, RETRY_AFTER_MS).unref?.();
      const seedsPromise = Promise.resolve(seeds);
      cached = seedsPromise;
      return seeds;
    }
    const byKey = new Map(loaded.map((brand) => [brandKey(brand.slug), brand]));
    for (const seed of seeds) if (!byKey.has(brandKey(seed.slug))) byKey.set(brandKey(seed.slug), seed);
    return [...byKey.values()];
  })();
  return cached;
}

/** Only for tests: forget the in-process index and everything derived from it. */
export function resetBrandIndex() { cached = null; table = null; retryAt = 0; }

/**
 * Rebuilding this per sentence is ~7,000 map writes each time, and a ten-minute video
 * is a few hundred sentences. It is derived purely from the index, so it is cached
 * alongside it and thrown away whenever the index is.
 */
let table: Map<string, Brand & { words: number }> | null = null;
/** How many words a name is written as. "Google Drive" is two; "Nextdoor" is one. */
const wordsIn = (name: string) => name.trim().split(/[\s-]+/).filter(Boolean).length;

function lookupTable(brands: Brand[]): Map<string, Brand & { words: number }> {
  if (table) return table;
  const built = new Map<string, Brand & { words: number }>();
  const add = (name: string, brand: Brand) => {
    const key = brandKey(name);
    // Longer, more specific titles lose to nothing; first writer wins so that a
    // seeded brand is never shadowed by an obscure index entry with the same name.
    // The word count travels with the key: "next door" concatenates to the same key
    // as "Nextdoor", and must not be allowed to claim it.
    if (key.length >= 2 && !built.has(key)) built.set(key, { ...brand, words: Math.max(1, wordsIn(name)) });
  };
  for (const brand of brands) add(brand.title, brand);
  for (const brand of brands) { add(brand.slug, brand); for (const alias of brand.aliases) add(alias, brand); }
  table = built;
  return built;
}

/** Resolve one written name to a brand, or null. Never throws, never needs the network twice. */
export async function findBrand(name: string): Promise<Brand | null> {
  const table = lookupTable(await brandIndex());
  return table.get(brandKey(name)) ?? null;
}

/**
 * Words too ordinary to be a brand when capitalisation cannot vouch for them.
 * Simple Icons lists "Go", "Arc", "X", "Box", "Dash", "Lens" and "Spring"; in a
 * transcript with no usable casing, every one of those is almost always the
 * ordinary word. Two-word names are unambiguous and never go through this.
 */
const AMBIGUOUS = new Set([
  "go","arc","box","dash","lens","spring","pop","flow","air","sound","wave","link","home","page","post",
  "chain","block","node","edge","cloud","core","base","hub","kit","lab","line","list","loop","mark","mesh",
  "mint","mix","move","need","next","open","pay","peak","play","plus","poll","port","push","read","ring",
  "rise","rush","sage","save","seek","send","ship","shop","show","sign","site","slide","snap","space",
  "spark","speed","spin","split","spot","stack","star","step","stop","store","stream","swift","tab","take",
  "talk","task","team","tempo","test","text","thing","think","time","tool","top","track","trade","tree",
  "trend","true","turn","unite","unity","view","voice","watch","wave","way","well","wide","wind","wire",
  "wise","word","work","world","write","zone","apple","orange","amazon","square","shell","oracle","visa",
  "meta","medium","element","rest","set","split","term","total","union","value","vector","volume",
]);

/** How much the writing's capitalisation can be trusted to mark a name. */
export type Casing = "mixed" | "upper" | "lower";

/**
 * Auto-captions arrive lowercase and unpunctuated; some imports arrive in block
 * capitals. In both, a capital letter says nothing, so the single-word rule below
 * has to change rather than silently find everything or nothing.
 */
export function transcriptCasing(text: string): Casing {
  const words = text.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
  if (words.length < 8) return "mixed";
  const capitalised = words.filter((word) => /^\p{Lu}/u.test(word)).length;
  const share = capitalised / words.length;
  if (share > 0.9) return "upper";
  if (share < 0.06) return "lower";
  return "mixed";
}

/**
 * Every brand named in a piece of text, in the order it appears. Multi-word names
 * are tried first so "Google Drive" does not degrade to "Google".
 */
export async function brandsInText(
  text: string,
  options: { maxWords?: number; casing?: Casing } = {},
): Promise<Array<{ brand: Brand; index: number; match: string }>> {
  const maxWords = options.maxWords ?? 3;
  const casing = options.casing ?? "mixed";
  const table = lookupTable(await brandIndex());
  const tokens = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}.'+-]*/gu)];
  const found: Array<{ brand: Brand; index: number; match: string }> = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    let matched = false;
    for (let span = Math.min(maxWords, tokens.length - cursor); span >= 1 && !matched; span--) {
      const words = tokens.slice(cursor, cursor + span).map((t) => t[0]);
      if (span === 1 && !acceptsSingleWord(words[0], casing, cursor === 0)) continue;
      // A run of ordinary words that happens to spell a brand when glued together is
      // not that brand: in ordinary casing every word of a multi-word name is capitalised.
      if (span > 1 && casing === "mixed" && !words.every((word) => /^[A-Z0-9]/.test(word))) continue;
      const brand = table.get(brandKey(words.join("")));
      if (!brand || brand.words !== span) continue;
      found.push({ brand, index: tokens[cursor].index, match: words.join(" ") });
      cursor += span;
      matched = true;
    }
    if (!matched) cursor += 1;
  }
  return found;
}

/**
 * With ordinary casing a capital letter is the evidence. Without it, length and
 * ordinariness are all that is left: "kubernetes" is a safe bet, "go" is not.
 */
function acceptsSingleWord(word: string, casing: Casing, sentenceInitial: boolean): boolean {
  const key = brandKey(word);
  // A capital at the start of a sentence is grammar, not a name — "Go to the
  // store", "Meta question" — so there the ordinariness test applies as well.
  if (casing === "mixed") return /^[A-Z0-9]/.test(word) && (!sentenceInitial || (key.length >= 4 && !AMBIGUOUS.has(key)));
  return key.length >= 4 && !AMBIGUOUS.has(key);
}

/**
 * The mark is drawn on a white plate. A brand whose own colour is white — Sony, Unity
 * and a good many more in the index — would render as an empty square, so anything
 * too light to read on white is drawn in near-black instead.
 */
export function legibleHex(hex: string): string {
  const value = /^[0-9a-f]{6}$/i.test(hex) ? hex : "000000";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.82 ? "111111" : value;
}

export function brandHit(brand: Brand): ImageHit {
  const hex = legibleHex(brand.hex);
  return {
    provider: "brand",
    id: brand.slug,
    title: `${brand.title} logo`,
    url: `https://cdn.simpleicons.org/${brand.slug}/${hex}`,
    thumbUrl: `https://cdn.simpleicons.org/${brand.slug}/${hex}`,
    pageUrl: `https://simpleicons.org/?q=${encodeURIComponent(brand.slug)}`,
    license: "CC0",
    creator: "Simple Icons",
    width: 512,
    height: 512,
    relevance: 1,
  };
}

/**
 * A logo search, not a picture search. It answers only when the query *is* a brand
 * name, so asking for "a developer working hard" returns nothing rather than noise.
 */
export const brand: ImageProvider = {
  id: "brand",
  async search(query, limit) {
    const exact = await findBrand(query);
    if (exact) return [brandHit(exact)];
    const named = await brandsInText(query);
    const seen = new Set<string>();
    return named
      .filter(({ brand: b }) => !seen.has(b.slug) && seen.add(b.slug))
      .slice(0, limit)
      .map(({ brand: b }) => ({ ...brandHit(b), relevance: 0.9 }));
  },
};
