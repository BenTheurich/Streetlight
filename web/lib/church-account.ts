import { withWorkspaceDatabase } from './sqlite-persistence.ts';

export type ChurchAccount = {
  churchName: string;
  accessKind: 'standard' | 'founding' | 'sponsored';
};

export function getChurchAccount(organizationId: string, filename?: string): ChurchAccount {
  if (!organizationId) throw new Error('Church account not found');
  return withWorkspaceDatabase(filename, (database) => {
    const account = database
      .prepare(
        'SELECT name AS churchName, access_kind AS accessKind FROM churches WHERE auth_organization_id = ?',
      )
      .get(organizationId) as ChurchAccount | undefined;
    if (!account) throw new Error('Church account not found');
    return { ...account };
  });
}
