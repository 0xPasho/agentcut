/**
 * The half of the marketplace that lives on GitHub. A pack is a repository (or a folder
 * in one) pinned to a commit, so this file resolves a pasted address into an owner, a
 * repository, a folder and a SHA, and reads files at that SHA.
 *
 * Nothing here stores anything: the bytes of a pack stay on GitHub, and the URL we hand
 * out is `raw.githubusercontent.com/<owner>/<repo>/<sha>/<folder>`, which the studio and
 * the CLI already install from like any other URL.
 */
import type { Bindings } from "../env";

export const API_BASE = "https://api.github.com";
export const RAW_BASE = "https://raw.githubusercontent.com";

const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?$/;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export type RepoRef = { owner: string; repo: string; folder: string; ref: string | null };

export type Repo = {
  owner: string;
  repo: string;
  defaultBranch: string;
  stars: number;
  private: boolean;
  ownerAvatar: string | null;
  htmlUrl: string;
};

/**
 * What somebody may paste: a repository page, a folder inside one, a clone URL, or just
 * `owner/repo`. A `/tree/<ref>/<folder>` address carries its own folder and branch.
 */
export function parseRepoInput(input: string, folderField = ""): RepoRef | { error: string } {
  const text = input.trim();
  if (!text) return { error: "Paste the address of a public GitHub repository." };

  let rest = text
    .replace(/^git@github\.com:/i, "")
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\.git(?=$|[/?#])/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  if (/^https?:\/\//i.test(rest)) return { error: "That is not a github.com address." };

  const parts = rest.split("/").filter(Boolean);
  const [owner, repo, ...tail] = parts;
  if (!owner || !repo) return { error: "Use the form github.com/owner/repository." };
  if (!OWNER_RE.test(owner) || !NAME_RE.test(repo)) return { error: `That is not a repository name: ${owner}/${repo}` };

  let ref: string | null = null;
  let folder = "";
  if (tail[0] === "tree" || tail[0] === "blob") {
    ref = tail[1] ?? null;
    folder = tail.slice(2).join("/");
    if (!ref) return { error: "That link points at a branch that is not named." };
  } else if (tail.length) {
    folder = tail.join("/");
  }
  // A folder typed into its own field wins over one carried by the link.
  if (folderField.trim()) folder = folderField.trim();
  folder = folder.replace(/^\/+|\/+$/g, "");
  if (folder === "pack.json") folder = "";
  if (folder.endsWith("/pack.json")) folder = folder.slice(0, -"/pack.json".length);
  const problem = folder ? folderProblem(folder) : null;
  if (problem) return { error: problem };
  return { owner, repo, folder, ref };
}

function folderProblem(folder: string): string | null {
  if (folder.length > 256) return "That folder path is too long.";
  if (folder.includes("\\")) return "Use forward slashes in the folder path.";
  if (folder.split("/").some((s) => s === "" || s === "." || s === "..")) return `That is not a folder in the repository: ${folder}`;
  if (/[\u0000-\u001f\u007f]/.test(folder)) return "That folder path has characters that cannot be in a path.";
  return null;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Reads from GitHub, as the signed-in person when Clerk handed us their token. */
export class GitHub {
  private readonly api: string;
  private readonly raw: string;

  constructor(env: Pick<Bindings, "GITHUB_API_BASE" | "GITHUB_RAW_BASE">, private readonly token: string | null = null) {
    this.api = (env.GITHUB_API_BASE || API_BASE).replace(/\/+$/, "");
    this.raw = (env.GITHUB_RAW_BASE || RAW_BASE).replace(/\/+$/, "");
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = { accept, "user-agent": "agentcut-web" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await fetch(`${this.api}${path}`, { headers: this.headers("application/vnd.github+json") });
    if (res.status === 404) throw new GitHubError("GitHub has no such repository, branch or file, or it is private.", 404);
    if (res.status === 403 || res.status === 429) throw new GitHubError("GitHub is rate limiting us. Try again in a few minutes.", 429);
    if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}.`, 502);
    return (await res.json()) as T;
  }

  async repo(owner: string, repo: string): Promise<Repo> {
    const data = await this.json<{
      name: string;
      default_branch: string;
      stargazers_count: number;
      private: boolean;
      html_url: string;
      owner: { login: string; avatar_url: string | null };
    }>(`/repos/${owner}/${repo}`);
    return {
      owner: data.owner.login,
      repo: data.name,
      defaultBranch: data.default_branch,
      stars: data.stargazers_count ?? 0,
      private: Boolean(data.private),
      ownerAvatar: data.owner.avatar_url ?? null,
      htmlUrl: data.html_url,
    };
  }

  /** The commit a branch, a tag or a SHA points at right now. A pack is pinned to this. */
  async commit(owner: string, repo: string, ref: string): Promise<string> {
    const data = await this.json<{ sha: string }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
    if (!/^[0-9a-f]{40}$/i.test(data.sha)) throw new GitHubError("GitHub answered with no commit for that branch.", 502);
    return data.sha;
  }

  /**
   * Every file in the commit, as paths. `truncated` means the repository is too large to
   * list in one answer, and the caller checks the files it cares about one by one.
   */
  async tree(owner: string, repo: string, sha: string): Promise<{ files: Map<string, number>; truncated: boolean }> {
    const data = await this.json<{ tree: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>(
      `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    );
    const files = new Map<string, number>();
    for (const entry of data.tree) if (entry.type === "blob") files.set(entry.path, entry.size ?? 0);
    return { files, truncated: Boolean(data.truncated) };
  }

  rawUrl(owner: string, repo: string, sha: string, path: string): string {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${this.raw}/${owner}/${repo}/${sha}${encoded ? `/${encoded}` : ""}`;
  }

  /** A file at a commit, or null when it is not there. Read from raw, which has no rate limit. */
  async file(owner: string, repo: string, sha: string, path: string): Promise<string | null> {
    const res = await fetch(this.rawUrl(owner, repo, sha, path), { headers: this.headers("text/plain") });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(`GitHub answered ${res.status} for ${path}.`, 502);
    return res.text();
  }

  async exists(owner: string, repo: string, sha: string, path: string): Promise<boolean> {
    const res = await fetch(this.rawUrl(owner, repo, sha, path), { method: "HEAD", headers: this.headers("*/*") });
    return res.ok;
  }
}
