const DEFAULT_DATE_FORMAT = 'yyyy-MM-dd HH:mm';

let activeDateFormat = DEFAULT_DATE_FORMAT;

export function setDateFormat(fmt: string): void {
  activeDateFormat = fmt || DEFAULT_DATE_FORMAT;
}

function applyDateFormat(d: Date, fmt: string): string {
  const yyyy = String(d.getFullYear());
  const MM   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const HH   = String(d.getHours()).padStart(2, '0');
  const mm   = String(d.getMinutes()).padStart(2, '0');
  return fmt
    .replace('yyyy', yyyy)
    .replace('MM', MM)
    .replace('dd', dd)
    .replace('HH', HH)
    .replace('mm', mm);
}

export function formatDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return applyDateFormat(d, activeDateFormat);
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function estimateReadingTime(text: string): string {
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}
