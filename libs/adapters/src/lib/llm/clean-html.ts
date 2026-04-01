/**
 * Cleans LLM output that may contain markdown artifacts instead of pure HTML.
 * Strips code fences, converts markdown bold/headers/lists to HTML equivalents.
 */
export function cleanHtml(raw: string): string {
  let html = raw.trim();

  // Strip code fences (```html ... ``` or ``` ... ```)
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Convert markdown headers to HTML (### Title -> <h3>Title</h3>)
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');

  // Convert markdown bold (**text**) to <strong>
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert markdown unordered lists (- item or * item) that aren't already in HTML
  // Only convert lines that start with - or * and aren't inside HTML tags
  html = html.replace(/^[-*]\s+(.+)$/gm, (_, content) => {
    // Skip if already wrapped in <li>
    if (content.trim().startsWith('<')) return content;
    return `<li>${content}</li>`;
  });

  // Wrap consecutive <li> blocks in <ul> if not already wrapped
  html = html.replace(/(?:^|\n)(<li>[\s\S]*?<\/li>\n?)+/gm, (match) => {
    if (match.includes('<ul>')) return match;
    return `<ul>\n${match.trim()}\n</ul>`;
  });

  return html.trim();
}
