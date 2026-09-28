import { useEffect } from 'react';
import { StatusCard } from '../../components/ui/StatusCard/StatusCard';
import { Button } from '../../components/ui/Button/Button';

// Shown when the app detects it is not authenticated (any API call returns 401). The user
// is offered a Google sign-in button and, when sign-in fails, a brief reason why.

/**
 * Maps every known `auth_error` query param value to a human-readable sentence. Keep copy short
 * (one or two sentences) so it fits the StatusCard note slot without reflowing the card.
 */
const authErrorMessages: Record<string, string> = {
  /** User dismissed or cancelled on Google's consent screen. */
  denied: 'Sign-in was cancelled. You can try again whenever you are ready.',
  /** Email is not on the allow-list for this space. */
  not_allowed:
    'This account does not have access to this space. Sign in with the account the space was set up for.',
  /** Google account email is not verified — not an access problem, just unverified. */
  email_unverified:
    'Your Google account email address is not verified. Verify it with Google, then try signing in again.',
  /** OAuth state cookie missing or mismatched: timed out, back button used, or opened in another tab. */
  expired: 'The sign-in attempt timed out or was interrupted. Return to this screen and try again.',
  /** Google returned no authorization code. */
  no_code: 'Google did not complete the sign-in. Try again.',
  /** Token exchange or ID-token verification failed — server misconfiguration or Google outage. */
  provider_error:
    'Could not complete sign-in with Google. This is usually a server-side problem; if it persists, the server needs attention.',
};

/** Shown for any code not present in the map above. */
const FALLBACK_ERROR_MESSAGE = 'Sign-in did not complete. Try again.';

/**
 * The full-window sign-in screen. Reads the `auth_error` query param on mount; if present, shows
 * an error message and removes the param from the URL without a navigation so the back button
 * still works.
 *
 * The sign-in button does a full-page redirect to /api/auth/google rather than a fetch, because
 * the OAuth flow requires navigating the top-level frame through the provider.
 */
export function SignInScreen() {
  // Derived from the URL at render time; no state needed because the value never changes
  // while this screen is mounted.
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const authErrorKey = params.get('auth_error') ?? '';
  const authErrorMessage = authErrorKey
    ? (authErrorMessages[authErrorKey] ?? FALLBACK_ERROR_MESSAGE)
    : null;

  // Clean the `auth_error` param from the URL after we have read it. This is a side effect
  // against the browser history API, so it belongs in useEffect.
  useEffect(() => {
    if (!authErrorKey) return;
    const clean = window.location.pathname + window.location.hash;
    history.replaceState(null, '', clean);
  }, [authErrorKey]);

  const handleSignIn = () => {
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <StatusCard
        className="w-[min(420px,calc(100vw-2rem))]"
        eyebrow="Personal Space"
        lead="Sign in to continue"
        note={authErrorMessage ?? undefined}
        eyebrowIntent={authErrorMessage ? 'error' : 'accent'}
      >
        <Button className="mt-4.5 w-full" onClick={handleSignIn}>
          Sign in with Google
        </Button>
      </StatusCard>
    </div>
  );
}
