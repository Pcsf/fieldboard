import { test, expect } from "bun:test";
import { parseMentions } from "../src/mentions";
import { markdown } from "../src/markdown";

const members = [
  { id: "ana-maria", name: "Ana Maria" },
  { id: "ana", name: "Ana" },
  { id: "bob", name: "Bob O'Brien" },
];

test("mentions: matches a member name containing a space", () => {
  const matches = parseMentions("Please loop in @Ana Maria on this.", members);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.memberId).toBe("ana-maria");
  expect(matches[0]!.name).toBe("Ana Maria");
});

test("mentions: longest match wins when one name is a prefix of another", () => {
  const matches = parseMentions("@Ana Maria please review", members);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.memberId).toBe("ana-maria");
});

test("mentions: shorter name still matches on its own", () => {
  const matches = parseMentions("@Ana please review", members);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.memberId).toBe("ana");
});

test("mentions: unknown name stays unmatched", () => {
  const matches = parseMentions("@Bob Smith is not a member", members);
  expect(matches).toHaveLength(0);
});

test("mentions: punctuation immediately after a name still matches", () => {
  const matches = parseMentions("@Ana Maria, thanks for the review.", members);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.name).toBe("Ana Maria");
});

test("mentions: a longer word sharing a prefix does not falsely match", () => {
  const matches = parseMentions("@Ana Marianoland is not Ana Maria", members);
  // "Ana Maria" cannot match "Ana Marianoland" (word char immediately follows); "Ana" alone can.
  expect(matches).toHaveLength(1);
  expect(matches[0]!.memberId).toBe("ana");
});

test("mentions: an @ immediately preceded by a word character is not a mention", () => {
  const matches = parseMentions("x@Ana is an email-like token, not a mention", members);
  expect(matches).toHaveLength(0);
});

test("mentions: case-insensitive match", () => {
  const matches = parseMentions("@ANA MARIA is shouting", members);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.memberId).toBe("ana-maria");
});

test("mentions: multiple distinct mentions in one text", () => {
  const matches = parseMentions("@Ana and @Bob O'Brien both commented", members);
  expect(matches.map(m => m.memberId)).toEqual(["ana", "bob"]);
});

test("mentions render as chips through markdown, and malicious member names stay inert", () => {
  const evilMembers = [
    { id: "evil-1", name: "<img src=x onerror=alert(1)>" },
    { id: "evil-2", name: '">' },
  ];
  const html = markdown("Hello @<img src=x onerror=alert(1)> and @\">", evilMembers);
  expect(html).not.toContain("<img"); // only the escaped &lt;img ... form may appear, never a real tag
  expect(html).toContain("mention-chip");
  expect(html).toContain("&lt;img");
});

test("markdown with an unknown mention leaves the text plain and escaped", () => {
  const html = markdown("Hi @Nobody, any update?", members);
  expect(html).not.toContain("mention-chip");
  expect(html).toContain("@Nobody");
});

test("markdown renders a known mention as a chip carrying the member's name", () => {
  const html = markdown("Hi @Ana Maria, any update?", members);
  expect(html).toContain("mention-chip");
  expect(html).toContain("Ana Maria");
});

test("markdown mentions are not expanded inside code spans", () => {
  const html = markdown("Use `@Ana Maria` as a literal example", members);
  expect(html).toContain("<code>@Ana Maria</code>");
  expect(html).not.toContain("mention-chip");
});
