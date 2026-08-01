export function packetDownloadProgress(
  scope: 'newest' | 'active' | null,
  newestPacketCount: number,
  activePacketCount: number,
): { busy: boolean; headline?: string; message: string | null } {
  if (!scope) return { busy: false, message: null };
  const count = scope === 'active' ? activePacketCount : newestPacketCount;
  return {
    busy: true,
    headline: scope === 'active' ? 'Preparing active packet PDF' : 'Preparing newest batch PDF',
    message: `Preparing ${count} packet maps and PDF…`,
  };
}
