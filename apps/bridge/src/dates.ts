/** Normalize DD/MM/YYYY or DD-MM-YYYY to ISO YYYY-MM-DD. */
export function toIsoDate(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const m = cleanDate(raw).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
    return undefined;
  }
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

export function cleanDate(raw: string) {
  return raw.replace(/\s+/g, " ").trim();
}

/** Extract first DD/MM/YYYY from a blob. */
export function extractDateLabel(text: string): string | undefined {
  const m = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
  return m?.[1];
}
