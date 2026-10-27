/**
 * Standard formatting utilities according to baseline/00-PROJECT-BRIEF.md §3:
 * Date: dd/MM/yyyy, 24h time
 * Score: 8,5 / 10
 * Thousand separator: dot (1.000)
 */

export function formatDateVN(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateTimeVN(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${formatDateVN(d)}`;
}

export function formatScoreVN(score: number | undefined | null): string {
  if (score === undefined || score === null) return '—';
  // Vietnamese format: comma for decimal
  return score.toFixed(1).replace('.', ',');
}

export function formatNumberVN(val: number | undefined | null): string {
  if (val === undefined || val === null) return '0';
  return val.toLocaleString('vi-VN');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',')} GB`;
}
