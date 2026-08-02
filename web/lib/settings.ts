export type ChurchPrintoutSettings = {
  message: string;
  reference: string;
};

export const defaultChurchPrintoutSettings: ChurchPrintoutSettings = {
  message: 'Ye are the light of the world.',
  reference: 'Matthew 5:14',
};

function normalizedLine(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new Error('Invalid printout settings');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maximum || !/^[\x20-\x7e]*$/.test(normalized)) {
    throw new Error('Invalid printout settings');
  }
  return normalized;
}

export function parseChurchPrintoutSettings(value: unknown): ChurchPrintoutSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid printout settings');
  const input = value as Record<string, unknown>;
  const message = normalizedLine(input.message, 80);
  const reference = normalizedLine(input.reference, 60);
  if (!message && reference) throw new Error('A reference requires a printout message');
  return { message, reference };
}
