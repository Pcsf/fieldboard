import { expect, test } from "bun:test";
import { validateLinkUrl, validateLink, buildLink, parseLinkInput, linkLabel, linkHref } from "../src/links";
import { createWorkspace, createProject, createCard, editCard, validateWorkspace, id } from "../src/model";

test("validateLinkUrl: accepts http/https and rejects javascript:, data: and malformed input", () => {
  expect(validateLinkUrl("https://example.com/a")).toBe("https://example.com/a");
  expect(validateLinkUrl("http://example.com")).toBe("http://example.com");
  expect(() => validateLinkUrl("javascript:alert(1)")).toThrow();
  expect(() => validateLinkUrl("data:text/html,<script>window.pwned=1</script>")).toThrow();
  expect(() => validateLinkUrl("not a url")).toThrow();
  expect(() => validateLinkUrl("")).toThrow();
});

test("parseLinkInput: recognises a github.com PR/issue/commit URL and otherwise falls back to a plain URL", () => {
  expect(parseLinkInput("https://github.com/acme/widgets/pull/42")).toEqual({ kind: "pr", repo: "acme/widgets", number: 42 });
  expect(parseLinkInput("https://github.com/acme/widgets/issues/7")).toEqual({ kind: "issue", repo: "acme/widgets", number: 7 });
  expect(parseLinkInput("https://github.com/acme/widgets/commit/1a2b3c4d5e6f")).toEqual({ kind: "commit", repo: "acme/widgets", sha: "1a2b3c4d5e6f" });
  expect(parseLinkInput("https://example.com/docs")).toEqual({ kind: "url", url: "https://example.com/docs" });
  expect(parseLinkInput("https://github.com/acme/widgets")).toEqual({ kind: "url", url: "https://github.com/acme/widgets" });
});

test("buildLink: produces the documented chip text for each kind and rejects javascript:", () => {
  const pr = buildLink({ kind: "pr", repo: "acme/widgets", number: 42 });
  expect(linkLabel(pr)).toBe("PR #42 · acme/widgets");
  expect(linkHref(pr)).toBe("https://github.com/acme/widgets/pull/42");

  const issue = buildLink({ kind: "issue", repo: "acme/widgets", number: 7 });
  expect(linkLabel(issue)).toBe("Issue #7 · acme/widgets");
  expect(linkHref(issue)).toBe("https://github.com/acme/widgets/issues/7");

  const commit = buildLink({ kind: "commit", repo: "acme/widgets", sha: "1a2b3c4d5e6f" });
  expect(linkLabel(commit)).toBe("commit 1a2b3c4");
  expect(linkHref(commit)).toBe("https://github.com/acme/widgets/commit/1a2b3c4d5e6f");

  const url = buildLink({ kind: "url", url: "https://example.com" });
  expect(linkLabel(url)).toBe("https://example.com");
  expect(linkHref(url)).toBe("https://example.com");

  expect(() => buildLink({ kind: "url", url: "javascript:alert(1)" })).toThrow();
  expect(() => buildLink({ kind: "commit", repo: "", sha: "abc1234" })).toThrow();
  expect(() => buildLink({ kind: "pr", repo: "acme/widgets", number: 0 })).toThrow();
});

test("linkHref: only http/https is clickable; a non-GitHub-shaped repo stays plain text", () => {
  const notGithubShaped = buildLink({ kind: "commit", repo: "just-one-name", sha: "abc1234" });
  expect(linkHref(notGithubShaped)).toBeNull();
  expect(linkLabel(notGithubShaped)).toBe("commit abc1234");
});

test("linkHref ignores a tampered stored url for non-url kinds (defense in depth)", () => {
  const link = { ...buildLink({ kind: "commit", repo: "acme/widgets", sha: "1a2b3c4d5e6f" }), url: "javascript:alert(document.title)" };
  expect(linkHref(link)).toBe("https://github.com/acme/widgets/commit/1a2b3c4d5e6f");
});

test("validateLink: refuses a javascript: URL on a plain-url link and an invalid kind", () => {
  expect(() => validateLink({ id: id(), title: "x", url: "javascript:alert(1)" })).toThrow();
  expect(() => validateLink({ id: id(), title: "x", url: "https://example.com", kind: "carrier-pigeon" })).toThrow();
  expect(() => validateLink({ id: id(), title: "commit abc1234", url: "", kind: "commit", repo: "a/b" })).toThrow(); // missing sha
});

test("model: adding and removing a link is a card mutation (Activity + undo) and round-trips", () => {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const column = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  const card = createCard(w, column.id, "Ship", "top");
  const before = w.activities.length;
  const link = buildLink({ kind: "pr", repo: "acme/widgets", number: 42 });
  editCard(w, card.id, { links: [link] });
  expect(w.activities.length).toBe(before + 1);
  expect(w.cards.find(c => c.id === card.id)!.links).toEqual([link]);
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
  editCard(w, card.id, { links: [] });
  expect(w.activities.length).toBe(before + 2);
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
});
