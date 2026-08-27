import { randomUUID } from 'node:crypto';
import type { OrganizationAccess } from './organization-access.ts';
import { withImmediateTransaction, withWorkspaceDatabase } from './sqlite-persistence.ts';
import { type Position, territoryBoundary } from './territory-geometry.ts';

export function getOrganizationAccess(
  organizationId: string,
  filename?: string,
): OrganizationAccess {
  if (!organizationId) throw new Error('Church workspace not found');
  return withWorkspaceDatabase(filename, (database) => {
    const rows = database
      .prepare(
        `SELECT c.id AS church_id, c.name AS church_name, c.time_zone,
          c.onboarding_completed_at, t.id AS territory_id
        FROM churches c
        LEFT JOIN territories t ON t.church_id = c.id
        WHERE c.auth_organization_id = ?
        ORDER BY t.created_at, t.id
        LIMIT 2`,
      )
      .all(organizationId) as Array<{
      church_id: string;
      church_name: string;
      time_zone: string;
      onboarding_completed_at: string | null;
      territory_id: string | null;
    }>;
    if (rows.length !== 1) throw new Error('Church workspace not found');
    return {
      churchId: rows[0].church_id,
      churchName: rows[0].church_name,
      timeZone: rows[0].time_zone,
      territoryId: rows[0].territory_id,
      onboardingCompleted: rows[0].onboarding_completed_at !== null,
    };
  });
}

export function createInitialTerritory(
  organizationId: string,
  input: {
    churchName: string;
    timeZone: string;
    formattedAddress: string;
    center: Position;
  },
  filename?: string,
): { territoryId: string } {
  return withImmediateTransaction(filename, (database) => {
    const church = database
      .prepare('SELECT id FROM churches WHERE auth_organization_id = ?')
      .get(organizationId) as { id: string } | undefined;
    if (!church) throw new Error('Church workspace not found');
    const existing = database
      .prepare('SELECT id FROM territories WHERE church_id = ?')
      .get(church.id) as { id: string } | undefined;
    if (existing) throw new Error('Church onboarding is already complete');

    database
      .prepare('UPDATE churches SET name = ?, time_zone = ? WHERE id = ?')
      .run(input.churchName, input.timeZone, church.id);
    const territoryId = `territory-${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO territories
          (id, church_id, name, center_latitude, center_longitude, radius_meters,
            boundary_geojson, origin_address, boundary_shape)
        VALUES (?, ?, 'Outreach territory', ?, ?, ?, ?, ?, 'circle')`,
      )
      .run(
        territoryId,
        church.id,
        input.center[1],
        input.center[0],
        1609.344,
        JSON.stringify(territoryBoundary(input.center, 1, 'circle')),
        input.formattedAddress,
      );
    return { territoryId };
  });
}
