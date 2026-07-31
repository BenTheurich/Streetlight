export function packetDownloadProgress(
  scope: 'newest' | 'active' | null,
  newestPacketCount: number,
  activePacketCount: number,
): { busy: boolean; message: string | null } {
  if (!scope) return { busy: false, message: null };
  const count = scope === 'active' ? activePacketCount : newestPacketCount;
  return { busy: true, message: `Preparing ${count} packet maps and PDF…` };
}
