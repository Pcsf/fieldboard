// Pure @mention parsing, independent of HTML rendering. Called twice with two different domains:
// once over raw card text with raw member names (model/notifications, to decide who gets notified),
// and once over already-escaped text with escaped member names (markdown.ts, to render a chip) --
// see DECISIONS "Mentions". A candidate only needs an id and a name, never the full Member shape.
export interface MentionCandidate { id: string; name: string }
export interface MentionMatch { memberId: string; name: string; start: number; end: number }

function isWordChar(ch: string | undefined): boolean { return !!ch && /[A-Za-z0-9_]/.test(ch); }

// Scans left to right for "@" not preceded by a word character (so "user@Name" stays plain, unlike a
// genuine mention at a word boundary), then tries every candidate name longest-first so "@Ana Maria"
// matches the full name rather than stopping at "@Ana". A match must also not be followed by a word
// character, so "@Ana Marianoland" cannot match "Ana Maria" -- only the shorter "Ana" candidate can.
export function parseMentions(text: string, members: MentionCandidate[]): MentionMatch[] {
  const candidates = members.filter(m => m.name.trim()).slice().sort((a, b) => b.name.length - a.name.length);
  const matches: MentionMatch[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@" || isWordChar(text[i - 1])) continue;
    for (const member of candidates) {
      const end = i + 1 + member.name.length;
      if (text.slice(i + 1, end).toLocaleLowerCase() !== member.name.toLocaleLowerCase()) continue;
      if (isWordChar(text[end])) continue;
      matches.push({ memberId: member.id, name: member.name, start: i, end });
      i = end - 1;
      break;
    }
  }
  return matches;
}
