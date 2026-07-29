import { AsyncLocalStorage } from 'node:async_hooks';

export type WorkspaceScope = Readonly<{
  churchId: string;
  territoryId: string;
  timeZone: string;
}>;

const workspaceScope = new AsyncLocalStorage<WorkspaceScope>();

export function runInWorkspace<T>(scope: WorkspaceScope, operation: () => T): T {
  return workspaceScope.run(scope, operation);
}

export function requireWorkspaceScope(): WorkspaceScope {
  const scope = workspaceScope.getStore();
  if (!scope) throw new Error('Church workspace scope is required');
  return scope;
}
