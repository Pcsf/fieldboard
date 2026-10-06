import { id, type Link } from "./model";

export const linkKinds = ["url", "commit", "issue", "pr"] as const;
export type LinkKind = typeof linkKinds[number];

function fail(message: string): never { throw new Error(message); }
function nonempty(x: unknown, label: string): asserts x is string { if (typeof x !== "string" || !x.trim()) fail(`${label} is required`); }

// A GitHub owner/repo slug: a locally typed label, not a looked-up repository, so this stays
// loose on purpose (anything without an internal slash or scheme). It only gates whether a
// constructed github.com link is offered as clickable.
const REPO_RE = /^[^\s/]+\/[^\s/]+$/;

export function validateLinkUrl(raw: string): string {
  const url = raw.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { return fail("Enter a full http:// or https:// link"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail("Only http:// and https:// links are supported");
  return url;
}

export function validateLink(input: unknown): asserts input is Link {
  if (!input || typeof input !== "object") fail("Invalid link");
  const l = input as Record<string, unknown>;
  nonempty(l.id, "Link id"); nonempty(l.title, "Link title");
  if (typeof l.url !== "string") fail("Link url must be text");
  const kind = l.kind;
  if (kind !== undefined) {
    if (!(linkKinds as readonly string[]).includes(kind as string)) fail("Unknown link kind");
    if (kind === "commit") { nonempty(l.repo, "Repository"); nonempty(l.sha, "Commit SHA"); }
    if (kind === "issue" || kind === "pr") {
      nonempty(l.repo, "Repository");
      if (typeof l.number !== "number" || !Number.isInteger(l.number) || l.number < 1) fail("Issue/PR number must be a positive whole number");
    }
  }
  if (kind === undefined || kind === "url") validateLinkUrl(l.url as string);
}

export interface LinkInput { kind: LinkKind; url?: string; repo?: string; sha?: string; number?: number }

export function buildLink(input: LinkInput): Link {
  if (input.kind === "url") {
    const url = validateLinkUrl(input.url ?? "");
    return { id: id(), title: url, url, kind: "url" };
  }
  const repo = (input.repo ?? "").trim();
  if (!repo) fail("Repository is required");
  if (input.kind === "commit") {
    const sha = (input.sha ?? "").trim();
    if (!sha) fail("Commit SHA is required");
    const url = REPO_RE.test(repo) ? `https://github.com/${repo}/commit/${sha}` : "";
    return { id: id(), title: `commit ${sha.slice(0, 7)}`, url, kind: "commit", repo, sha };
  }
  const number = input.number;
  if (!number || !Number.isInteger(number) || number < 1) fail("Issue/PR number must be a positive whole number");
  const kindWord = input.kind === "pr" ? "pull" : "issues";
  const url = REPO_RE.test(repo) ? `https://github.com/${repo}/${kindWord}/${number}` : "";
  return { id: id(), title: `${input.kind === "pr" ? "PR" : "Issue"} #${number} · ${repo}`, url, kind: input.kind, repo, number };
}

// Recognises a pasted github.com issue/PR/commit URL and turns it directly into the matching
// kind; anything else (including a github.com URL to something other than those three paths)
// falls back to a plain "url" link, validated the same way a hand-typed URL would be.
export function parseLinkInput(raw: string): LinkInput {
  const trimmed = raw.trim();
  let parsed: URL | null = null;
  try { parsed = new URL(trimmed); } catch { parsed = null; }
  if (parsed && /^(www\.)?github\.com$/i.test(parsed.hostname)) {
    const [owner, repo, kindPart, ref] = parsed.pathname.split("/").filter(Boolean);
    if (owner && repo && kindPart && ref) {
      const slug = `${owner}/${repo}`;
      if (kindPart === "pull" && /^\d+$/.test(ref)) return { kind: "pr", repo: slug, number: Number(ref) };
      if (kindPart === "issues" && /^\d+$/.test(ref)) return { kind: "issue", repo: slug, number: Number(ref) };
      if (kindPart === "commit" && /^[0-9a-f]{7,40}$/i.test(ref)) return { kind: "commit", repo: slug, sha: ref };
    }
  }
  return { kind: "url", url: trimmed };
}

export function linkLabel(link: Link): string {
  if (link.kind === "commit" && link.sha) return `commit ${link.sha.slice(0, 7)}`;
  if ((link.kind === "issue" || link.kind === "pr") && link.repo && link.number) return `${link.kind === "pr" ? "PR" : "Issue"} #${link.number} · ${link.repo}`;
  return link.title || link.url;
}

// Always recomputed from the typed kind fields, never from the stored `url` -- a hand-edited or
// imported workspace cannot smuggle a javascript: URL into a commit/issue/PR chip through that
// field, because this function never reads it for those kinds.
export function linkHref(link: Link): string | null {
  if (link.kind === "commit") return link.repo && link.sha && REPO_RE.test(link.repo) ? `https://github.com/${link.repo}/commit/${link.sha}` : null;
  if (link.kind === "issue" || link.kind === "pr") return link.repo && link.number && REPO_RE.test(link.repo) ? `https://github.com/${link.repo}/${link.kind === "pr" ? "pull" : "issues"}/${link.number}` : null;
  return /^https:\/\//i.test(link.url) || /^http:\/\//i.test(link.url) ? link.url : null;
}
