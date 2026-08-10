// Full-window states that sit outside a workspace: loading, failure, and a signed-in user with no
// workspace to open.

/** Shown while the first read of /api/me and the snapshot is in flight. */
export function AppLoading() {
  return (
    <div className="status">
      <div className="status__card">
        <p className="status__eyebrow">Personal Space</p>
        <p className="status__lead">Loading your workspace...</p>
      </div>
    </div>
  );
}

/** Shown when the app cannot reach the API or the API refuses. */
export function AppError({ message }: { message: string }) {
  return (
    <div className="status">
      <div className="status__card">
        <p className="status__eyebrow status__eyebrow--error">Something went wrong</p>
        <p className="status__lead">{message}</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * A signed-in user with an empty memberships array. Memberships are a current fact, not an
 * invariant, so this state exists rather than assuming memberships[0].
 */
export function NoWorkspace() {
  return (
    <div className="status">
      <div className="status__card">
        <p className="status__eyebrow">Personal Space</p>
        <p className="status__lead">You do not belong to a workspace yet.</p>
        <p className="status__note">
          {/* Future: a workspace picker and a create-workspace flow land here when one account can
              hold several workspaces. */}
          Ask for an invitation, or seed a workspace for this account.
        </p>
      </div>
    </div>
  );
}
