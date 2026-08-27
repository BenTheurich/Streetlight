export type ChurchPrintoutSettings = {
  message: string;
  reference: string;
};

export const defaultChurchPrintoutSettings: ChurchPrintoutSettings = {
  message: 'Ye are the light of the world.',
  reference: 'Matthew 5:14',
};

function normalizedLine(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string') throw new Error('Invalid printout settings');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer`);
  }
  if (!/^[\x20-\x7e]*$/.test(normalized)) {
    throw new Error(`${label} can use standard letters, numbers, and punctuation only`);
  }
  return normalized;
}

export function parseChurchPrintoutSettings(value: unknown): ChurchPrintoutSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid printout settings');
  const input = value as Record<string, unknown>;
  const message = normalizedLine(input.message, 80, 'Message');
  const reference = normalizedLine(input.reference, 60, 'Reference');
  if (!message && reference) throw new Error('A reference requires a printout message');
  return { message, reference };
}
