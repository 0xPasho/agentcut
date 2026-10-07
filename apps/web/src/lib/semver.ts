export const VERSION_RE = /^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/;

type Parsed = { core: [number, number, number]; pre: string[] };

function parse(v: string): Parsed {
  const [main, ...rest] = v.split("+")[0].split("-");
  const [a, b, c] = main.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pre = rest.length ? rest.join("-").split(".") : [];
  return { core: [a ?? 0, b ?? 0, c ?? 0], pre };
}

/** Semver precedence: core numbers, then a release beats any prerelease, then prerelease ids. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function highest(versions: string[]): string {
  return versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}
