export function formatDate(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function saveToLocalStorage(key: string, value: string): void {
  localStorage.setItem(key, value);
}
