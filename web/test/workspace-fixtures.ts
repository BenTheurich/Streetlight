import { runInWorkspace, type WorkspaceScope } from '../lib/workspace-scope.ts';

export const TEMECULA_TEST_WORKSPACE: WorkspaceScope = Object.freeze({
  churchId: 'church-temecula-pilot',
  territoryId: 'territory-temecula-pilot',
  timeZone: 'America/Los_Angeles',
});

export function withTemeculaWorkspace<T>(operation: () => T): T {
  return runInWorkspace(TEMECULA_TEST_WORKSPACE, operation);
}
