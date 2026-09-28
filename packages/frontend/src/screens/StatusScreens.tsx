import type { ReactNode } from 'react';
import { describeLoadFailure } from '../lib/errors';
import { StatusCard } from '../components/ui/StatusCard/StatusCard';
import { Button } from '../components/ui/Button/Button';

// Full-window states that sit outside a workspace: loading, failure, and a signed-in user with no
// workspace to open.

/** Wrapper that centers a StatusCard in the full viewport. Reused by all three status screens. */
function StatusScreenLayout({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center bg-canvas px-4">{children}</div>;
}

/** Shown while the first read of /api/me and the snapshot is in flight. */
export function AppLoading() {
  return (
    <StatusScreenLayout>
      <StatusCard
        className="w-[min(420px,calc(100vw-2rem))]"
        eyebrow="Personal Space"
        lead="Loading your workspace..."
      />
    </StatusScreenLayout>
  );
}

/**
 * Shown when the app cannot reach the API or the API refuses. It takes the error rather than a
 * message so a lost network reads as "you are offline" instead of the raw fetch text.
 */
export function AppError({ error }: { error: unknown }) {
  const { title, detail } = describeLoadFailure(error);
  return (
    <StatusScreenLayout>
      <StatusCard
        className="w-[min(420px,calc(100vw-2rem))]"
        eyebrowIntent="error"
        eyebrow={title}
        lead={detail}
      >
        {/* mt-4.5 matches the original .status__card .button { margin-top: 18px } rule. */}
        <Button className="mt-4.5" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </StatusCard>
    </StatusScreenLayout>
  );
}

/**
 * A signed-in user with an empty memberships array. Memberships are a current fact, not an
 * invariant, so this state exists rather than assuming memberships[0].
 */
export function NoWorkspace() {
  return (
    <StatusScreenLayout>
      <StatusCard
        className="w-[min(420px,calc(100vw-2rem))]"
        eyebrow="Personal Space"
        lead="You do not belong to a workspace yet."
        note={
          /* Future: a workspace picker and a create-workspace flow land here when one account can
             hold several workspaces. */
          'Ask for an invitation, or seed a workspace for this account.'
        }
      />
    </StatusScreenLayout>
  );
}
