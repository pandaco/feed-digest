export interface SnoozePreset {
  label: string;
  value: string;
}

export function getSnoozePresets(): SnoozePreset[] {
  const now = new Date();
  const today20 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0);
  const tomorrow8 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);

  const nextSaturday = new Date(now);
  nextSaturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  nextSaturday.setHours(9, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  nextWeek.setHours(8, 0, 0, 0);

  return [
    { label: 'Ce soir', value: today20.toISOString() },
    { label: 'Demain matin', value: tomorrow8.toISOString() },
    { label: 'Ce weekend', value: nextSaturday.toISOString() },
    { label: 'Dans 1 semaine', value: nextWeek.toISOString() },
  ];
}

export function formatSnoozeDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Now';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `In ${diffDays} days`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
