import { type ChurchPrintoutSettings, parseChurchPrintoutSettings } from './settings.ts';
import { withWorkspaceDatabase } from './sqlite-persistence.ts';
import { requireWorkspaceScope } from './workspace-scope.ts';

export function getChurchPrintoutSettings(filename?: string): ChurchPrintoutSettings {
  const { churchId } = requireWorkspaceScope();
  return withWorkspaceDatabase(filename, (database) => {
    const row = database
      .prepare(
        `SELECT packet_footer_message, packet_footer_reference
        FROM churches
        WHERE id = ?`,
      )
      .get(churchId) as
      | { packet_footer_message: string; packet_footer_reference: string }
      | undefined;
    if (!row) throw new Error('Church workspace not found');
    return { message: row.packet_footer_message, reference: row.packet_footer_reference };
  });
}

export function saveChurchPrintoutSettings(
  value: unknown,
  filename?: string,
): ChurchPrintoutSettings {
  const settings = parseChurchPrintoutSettings(value);
  const { churchId } = requireWorkspaceScope();
  return withWorkspaceDatabase(filename, (database) => {
    if (
      database
        .prepare(
          `UPDATE churches
          SET packet_footer_message = ?, packet_footer_reference = ?
          WHERE id = ?`,
        )
        .run(settings.message, settings.reference, churchId).changes !== 1
    ) {
      throw new Error('Church workspace not found');
    }
    return settings;
  });
}
