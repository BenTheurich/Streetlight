import type { AdministratorUser } from './auth.ts';
import type { AccountAction, AccountActivity } from './founder-account-types.ts';
import { withWorkspaceDatabase } from './sqlite-persistence.ts';

type ActivityInput = {
  churchId: string;
  user: AdministratorUser;
  action: AccountAction;
  outcome: AccountActivity['outcome'];
  targetId?: string | null;
};

type ResponseActivity = {
  outcome?: AccountActivity['outcome'];
  targetId?: string | null;
};

const responseActivities = new WeakMap<Response, ResponseActivity>();

// Metadata stays on the server and is never added to headers or response bodies.
export function withAccountActivity(response: Response, activity: ResponseActivity): Response {
  responseActivities.set(response, activity);
  return response;
}

export function recordAccountActivity(input: ActivityInput, filename?: string): void {
  try {
    withWorkspaceDatabase(filename, (database) => {
      database
        .prepare(
          `INSERT INTO account_activity
            (church_id, user_id, actor_name, actor_email, action, outcome, target_id, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.churchId,
          input.user.id,
          [input.user.firstName, input.user.lastName].filter(Boolean).join(' ').trim() || null,
          input.user.email,
          input.action,
          input.outcome,
          input.targetId && /^[A-Za-z0-9_-]{1,200}$/.test(input.targetId) ? input.targetId : null,
          new Date().toISOString(),
        );
    });
  } catch {
    // Support history must not change or roll back an administrator's action.
    console.warn('Could not record church account activity');
  }
}

export function recordAccountResponse(
  response: Response,
  input: Omit<ActivityInput, 'outcome' | 'targetId'>,
  filename?: string,
): Response {
  const metadata = responseActivities.get(response);
  const outcome =
    metadata?.outcome ??
    (response.status === 202
      ? 'started'
      : response.ok
        ? 'succeeded'
        : response.status >= 500
          ? 'failed'
          : 'rejected');
  recordAccountActivity({ ...input, outcome, targetId: metadata?.targetId }, filename);
  return response;
}
