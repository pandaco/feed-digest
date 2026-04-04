/**
 * Represents a single entry in a table of contents.
 */
export interface TocEntry {
  /** Heading level (2 for h2, 3 for h3) */
  level: 2 | 3;
  /** Text content of the heading */
  text: string;
}

/**
 * Extracts a table of contents from HTML by parsing h2 and h3 headings.
 * Uses regex-based extraction (no DOM dependency for server-side usage).
 */
export function extractToc(html: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const regex = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1], 10) as 2 | 3;
    // Strip inner HTML tags to get plain text
    const text = match[2].replace(/<[^>]*>/g, '').trim();
    if (text) {
      entries.push({ level, text });
    }
  }

  return entries;
}

/**
 * Checks whether a text content is considered "long" (> 1500 words).
 */
export function isLongContent(content: string): boolean {
  const text = content.replace(/<[^>]*>/g, ' ');
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  return wordCount > 1500;
}
