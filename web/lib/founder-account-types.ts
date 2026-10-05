import type { Polygon, Position } from './territory-geometry.ts';

export type AccountAction =
  | 'onboarding'
  | 'geocoding'
  | 'territory_save'
  | 'packet_proposals'
  | 'batch_finalization'
  | 'pdf_preparation'
  | 'reconciliation'
  | 'packet_correction'
  | 'printout_settings'
  | 'administrator_invitation'
  | 'administrator_revocation'
  | 'administrator_removal';

export type AccountActivity = {
  id: number;
  churchId: string;
  userId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: AccountAction;
  outcome: 'succeeded' | 'failed' | 'rejected' | 'started';
  targetId: string | null;
  recordedAt: string;
};

export type AccountIssue = {
  id: string;
  message: string;
  occurredAt: string | null;
  resolvedAt: string | null;
};

export type FounderChurchAccount = {
  id: string;
  name: string;
  timeZone: string;
  accessLabel: string;
  createdAt: string;
  contact: { name: string; email: string; location: string } | null;
  setupStatus:
    | 'invitation_pending'
    | 'accepted'
    | 'setting_up'
    | 'importing'
    | 'ready'
    | 'expired'
    | 'revoked'
    | 'unavailable';
  invitation: {
    state: 'pending' | 'accepted' | 'expired' | 'revoked' | 'unavailable';
    email: string;
    acceptedAt: string | null;
  } | null;
  identityAvailable: boolean;
  administrators: Array<{
    userId: string;
    name: string;
    email: string;
    lastActivityAt: string | null;
  }>;
  pendingInvitations: Array<{ id: string; email: string }>;
  territory: {
    id: string;
    address: string;
    center: Position;
    boundary: Polygon;
    distanceMiles: number;
    boundaryShape: 'circle' | 'square';
    estimatedHomes: number;
    segmentCount: number;
    importCompletedAt: string | null;
    warnings: string[];
  } | null;
  importJob: {
    id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';
    stage: string;
    createdAt: string;
    completedAt: string | null;
    error: string | null;
    attemptedAddress: string;
    attemptedDistanceMiles: number;
    attemptedBoundaryShape: 'circle' | 'square';
  } | null;
  packets: {
    batches: number;
    total: number;
    active: number;
    completed: number;
    cancelled: number;
    estimatedHomesReached: number;
  };
  lastActivity: AccountActivity | null;
  activities: AccountActivity[];
  activityTotal: number;
  issues: AccountIssue[];
};

export type FounderAccountsSnapshot = { churches: FounderChurchAccount[]; checkedAt: string };

export const accountActionLabels: Record<AccountAction, string> = {
  onboarding: 'Church details saved',
  geocoding: 'Church address lookup',
  territory_save: 'Territory save',
  packet_proposals: 'Packet previews generated',
  batch_finalization: 'Batch finalized',
  pdf_preparation: 'Packet PDF prepared',
  reconciliation: 'Packets reconciled',
  packet_correction: 'Packet correction',
  printout_settings: 'Printout settings saved',
  administrator_invitation: 'Administrator invitation',
  administrator_revocation: 'Invitation revoked',
  administrator_removal: 'Administrator removed',
};

export const setupStatusLabels: Record<FounderChurchAccount['setupStatus'], string> = {
  invitation_pending: 'Invitation pending',
  accepted: 'Invitation accepted',
  setting_up: 'Setup in progress',
  importing: 'Importing territory',
  ready: 'Ready',
  expired: 'Invitation expired',
  revoked: 'Invitation revoked',
  unavailable: 'Invitation status unavailable',
};
