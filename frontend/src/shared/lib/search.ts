/**
 * Vietnamese diacritics removal for robust normalized search
 */
export function removeVietnameseAccents(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function matchesSearchQuery(source: string, query: string): boolean {
  if (!query.trim()) return true;
  const normalizedSource = removeVietnameseAccents(source).toLowerCase();
  const normalizedQuery = removeVietnameseAccents(query).toLowerCase();
  return normalizedSource.includes(normalizedQuery);
}

export interface HighlightPart {
  text: string;
  isMatch: boolean;
}

export function splitForHighlight(text: string, query: string): HighlightPart[] {
  if (!query.trim() || !text) return [{ text, isMatch: false }];

  const normalizedText = removeVietnameseAccents(text).toLowerCase();
  const normalizedQuery = removeVietnameseAccents(query).toLowerCase();

  const parts: HighlightPart[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, startIndex);
    if (matchIndex === -1) {
      parts.push({ text: text.slice(startIndex), isMatch: false });
      break;
    }

    if (matchIndex > startIndex) {
      parts.push({ text: text.slice(startIndex, matchIndex), isMatch: false });
    }

    const matchLength = query.length;
    parts.push({ text: text.slice(matchIndex, matchIndex + matchLength), isMatch: true });
    startIndex = matchIndex + matchLength;
  }

  return parts;
}
