import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  type CoverageThresholds,
  type CoverageWorkspace,
  calendarDateInTimeZone,
  classifyCoverage,
  coverageLegend,
  parseCoverageThresholds,
  validateCoverageDate,
} from './coverage.ts';
import { interpretCoverageHistory, projectCoverageSegments } from './reconciliation-history.ts';
import { openSqliteDatabase, workspaceDatabaseFilename } from './sqlite-persistence.ts';
import { getTerritoryWorkspace } from './territory-persistence.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

function workspaceChurchId(): string {
  return requireWorkspaceScope().churchId;
}

function workspaceTerritoryId(): string {
  return requireWorkspaceScope().territoryId;
}

function workspaceTimeZone(): string {
  return requireWorkspaceScope().timeZone;
}

function todayForWorkspace(): string {
  return calendarDateInTimeZone(new Date(), workspaceTimeZone());
}

export function getCoverageWorkspace(
  filename?: string,
  asOf = todayForWorkspace(),
): CoverageWorkspace {
  validateCoverageDate(asOf, asOf);
  const territory = getTerritoryWorkspace(filename);
  const database = openSqliteDatabase(filename);
  try {
    const thresholdRow = database
      .prepare(
        `SELECT coverage_yellow_after_days, coverage_orange_after_days,
          coverage_red_after_days
        FROM territories
        WHERE id = ? AND church_id = ?`,
      )
      .get(workspaceTerritoryId(), workspaceChurchId()) as
      | {
          coverage_yellow_after_days: number;
          coverage_orange_after_days: number;
          coverage_red_after_days: number;
        }
      | undefined;
    if (!thresholdRow) throw new Error('Territory not found');
    const thresholds = parseCoverageThresholds({
      yellowAfterDays: thresholdRow.coverage_yellow_after_days,
      orangeAfterDays: thresholdRow.coverage_orange_after_days,
      redAfterDays: thresholdRow.coverage_red_after_days,
    });
    const events = database
      .prepare(
        `SELECT ce.id, s.import_segment_id AS segment_id, ce.rowid AS sequence,
          ce.packet_id, ce.completion_group_id, ce.covered_on, ce.kind,
          ce.corrects_event_id, ce.is_void
        FROM coverage_events ce
        JOIN street_segments s ON s.id = ce.street_segment_id
        WHERE ce.church_id = ? AND s.territory_id = ?
        ORDER BY ce.rowid`,
      )
      .all(workspaceChurchId(), workspaceTerritoryId())
      .map((row) => {
        const event = row as {
          id: string;
          segment_id: string;
          sequence: number;
          packet_id: string | null;
          completion_group_id: string | null;
          covered_on: string;
          kind: 'completed' | 'correction';
          corrects_event_id: string | null;
          is_void: number;
        };
        return {
          id: event.id,
          targetId: event.segment_id,
          targetKind: 'street' as const,
          packetId: event.packet_id,
          completionGroupId: event.completion_group_id,
          sequence: event.sequence,
          coveredOn: event.covered_on,
          kind: event.kind,
          correctsEventId: event.corrects_event_id,
          isVoid: event.is_void === 1,
        };
      });
    const apartmentEvents = database
      .prepare(
        `SELECT ce.id, a.import_complex_id AS complex_id, ce.rowid AS sequence,
          ce.packet_id, ce.completion_group_id, ce.covered_on, ce.kind,
          ce.corrects_event_id, ce.is_void
        FROM coverage_events ce
        JOIN apartment_complexes a ON a.id = ce.apartment_complex_id
        WHERE ce.church_id = ? AND a.territory_id = ?
        ORDER BY ce.rowid`,
      )
      .all(workspaceChurchId(), workspaceTerritoryId())
      .map((row) => {
        const event = row as {
          id: string;
          complex_id: string;
          sequence: number;
          packet_id: string | null;
          completion_group_id: string | null;
          covered_on: string;
          kind: 'completed' | 'correction';
          corrects_event_id: string | null;
          is_void: number;
        };
        return {
          id: event.id,
          targetId: event.complex_id,
          targetKind: 'apartment' as const,
          packetId: event.packet_id,
          completionGroupId: event.completion_group_id,
          sequence: event.sequence,
          coveredOn: event.covered_on,
          kind: event.kind,
          correctsEventId: event.corrects_event_id,
          isVoid: event.is_void === 1,
        };
      });
    const derived = new Map(
      projectCoverageSegments(
        interpretCoverageHistory(events, asOf),
        territory.segments.map(({ id, estimatedHomes, eligible }) => ({
          id,
          estimatedHomes,
          eligible,
        })),
      ).map((segment) => [segment.id, segment]),
    );
    const apartmentDerived = new Map(
      projectCoverageSegments(
        interpretCoverageHistory(apartmentEvents, asOf),
        territory.apartmentComplexes.map((apartment) => ({
          id: apartment.id,
          estimatedHomes: apartment.estimatedTracts,
          eligible: apartment.withinBoundary && apartment.reviewStatus === 'ready',
        })),
      ).map((apartment) => [apartment.id, apartment]),
    );
    const activePackets = (
      database
        .prepare('SELECT COUNT(*) AS count FROM packets WHERE church_id = ? AND status = ?')
        .get(workspaceChurchId(), 'active') as { count: number }
    ).count;
    const latestBatchRow = database
      .prepare(
        `SELECT b.id, b.name, COUNT(p.id) AS packet_count,
          COALESCE(SUM(p.estimated_homes), 0) AS estimated_homes
        FROM batches b
        JOIN packets p ON p.batch_id = b.id AND p.church_id = b.church_id
        WHERE b.church_id = ? AND b.finalized_at IS NOT NULL
        GROUP BY b.id
        ORDER BY b.finalized_at DESC, b.id DESC
        LIMIT 1`,
      )
      .get(workspaceChurchId()) as
      | {
          id: string;
          name: string;
          packet_count: number;
          estimated_homes: number;
        }
      | undefined;

    return {
      id: territory.id,
      churchName: territory.churchName,
      name: territory.name,
      center: territory.center,
      asOf,
      activePackets,
      latestBatch: latestBatchRow
        ? {
            id: latestBatchRow.id,
            name: latestBatchRow.name,
            packetCount: latestBatchRow.packet_count,
            estimatedHomes: latestBatchRow.estimated_homes,
          }
        : null,
      thresholds,
      legend: coverageLegend(thresholds),
      dataMode:
        path.basename(workspaceDatabaseFilename(filename)).toLowerCase() === 'coverage-demo.db'
          ? 'demo'
          : 'canonical',
      qualityWarnings: territory.import.quality?.warnings ?? [],
      apartmentComplexes: territory.apartmentComplexes
        .filter(({ withinBoundary }) => withinBoundary)
        .map((apartment) => {
          const coverage = apartmentDerived.get(apartment.id);
          if (!coverage) throw new Error('Apartment coverage missing');
          return {
            ...apartment,
            lastCoveredOn: coverage.lastCoveredOn,
            coverageClass: classifyCoverage(coverage.lastCoveredOn, asOf, thresholds),
            roots: coverage.roots,
          };
        }),
      segments: territory.segments
        .filter(
          (segment) => segment.excludedReason !== 'boundary' && segment.excludedReason !== 'hidden',
        )
        .map((segment) => {
          const coverage = derived.get(segment.id);
          if (!coverage) throw new Error('Coverage segment missing');
          return {
            id: segment.id,
            roadGroupId: segment.roadGroupId,
            streetName: segment.streetName,
            geometry: segment.geometry,
            estimatedHomes: segment.estimatedHomes,
            eligible: segment.eligible,
            excludedReason: segment.excludedReason,
            lastCoveredOn: coverage.lastCoveredOn,
            coverageClass: classifyCoverage(coverage.lastCoveredOn, asOf, thresholds),
            roots: coverage.roots,
          };
        }),
      totals: { eligibleHomes: territory.totals.eligibleHomes },
    };
  } finally {
    database.close();
  }
}

export function saveCoverageThresholds(
  value: CoverageThresholds,
  filename?: string,
): CoverageWorkspace {
  const thresholds = parseCoverageThresholds(value);
  const database = openSqliteDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = database
      .prepare(
        `UPDATE territories
        SET coverage_yellow_after_days = ?, coverage_orange_after_days = ?,
          coverage_red_after_days = ?
        WHERE id = ? AND church_id = ?`,
      )
      .run(
        thresholds.yellowAfterDays,
        thresholds.orangeAfterDays,
        thresholds.redAfterDays,
        workspaceTerritoryId(),
        workspaceChurchId(),
      );
    if (result.changes !== 1) throw new Error('Territory not found');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getCoverageWorkspace(filename);
}
export function appendCoverageCorrection(
  eventId: string,
  coveredOn: string | null,
  filename?: string,
): CoverageWorkspace {
  if (coveredOn !== null) validateCoverageDate(coveredOn, todayForWorkspace());
  const database = openSqliteDatabase(filename);
  database.exec('BEGIN IMMEDIATE');
  try {
    const root = database
      .prepare(
        `SELECT id, church_id, street_segment_id, covered_on, packet_id
        FROM coverage_events
        WHERE id = ? AND church_id = ? AND kind = 'completed'`,
      )
      .get(eventId, workspaceChurchId()) as
      | {
          id: string;
          church_id: string;
          street_segment_id: string;
          covered_on: string;
          packet_id: string | null;
        }
      | undefined;
    if (!root) throw new Error('Coverage event not found');
    if (root.packet_id) {
      throw new Error('Packet-managed coverage must be corrected in Reconcile packets');
    }
    const latest = database
      .prepare(
        `SELECT covered_on, is_void FROM coverage_events
        WHERE corrects_event_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(eventId) as { covered_on: string; is_void: number } | undefined;
    if (coveredOn === null && latest?.is_void === 1)
      throw new Error('Coverage event is already void');
    const effectiveDate = latest?.is_void === 0 ? latest.covered_on : root.covered_on;
    const correctionDate = coveredOn ?? effectiveDate;
    database
      .prepare(
        `INSERT INTO coverage_events
          (id, church_id, street_segment_id, covered_on, kind, corrects_event_id, is_void)
        VALUES (?, ?, ?, ?, 'correction', ?, ?)`,
      )
      .run(
        randomUUID(),
        root.church_id,
        root.street_segment_id,
        correctionDate,
        eventId,
        coveredOn === null ? 1 : 0,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getCoverageWorkspace(filename);
}
