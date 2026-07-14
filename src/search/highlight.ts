// Keyword (lexical) highlighting for search results — not semantic. A result may
// have no highlighted terms even when it is semantically relevant.

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function combinedPattern(terms: string[], flags: string): RegExp {
  return new RegExp(`\\b(${terms.map(escapeRegex).join('|')})\\b`, flags);
}

/** Meaningful query terms, longest-first so short terms don't match inside bolded ones. */
export function extractTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.trim().split(/\s+/)) {
    if (raw.length < 3) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(raw);
    }
  }
  terms.sort((a, b) => b.length - a.length);
  return terms;
}

export function highlightText(text: string, terms: string[]): string {
  if (!terms.length) return text;
  return text.replace(combinedPattern(terms, 'gi'), '**$1**');
}

export function hasTermMatch(text: string, terms: string[]): boolean {
  if (!terms.length) return false;
  return combinedPattern(terms, 'i').test(text);
}

export function extractSnippet(text: string, terms: string[], contextChars = 300): string {
  if (text.length <= contextChars) return highlightText(text, terms);
  const match = terms.length > 0 ? text.match(combinedPattern(terms, 'i')) : null;
  const matchIndex = match?.index ?? -1;
  if (matchIndex === -1) return text.slice(0, contextChars) + '…';
  const half = Math.floor(contextChars / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, start + contextChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + highlightText(text.slice(start, end), terms) + suffix;
}
