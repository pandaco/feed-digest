const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return dateFormatter.format(d);
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function estimateReadingTime(text: string): string {
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}
