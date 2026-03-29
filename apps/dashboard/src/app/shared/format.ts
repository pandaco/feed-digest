export function formatDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function saveToLocalStorage(key: string, value: string): void {
  localStorage.setItem(key, value);
}
