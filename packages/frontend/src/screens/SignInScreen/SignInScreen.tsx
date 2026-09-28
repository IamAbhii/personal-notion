import { useEffect } from 'react';
import { StatusCard } from '../../components/ui/StatusCard/StatusCard';
import { Button } from '../../components/ui/Button/Button';

// Shown when the app detects it is not authenticated (any API call returns 401). The user
// is offered a Google sign-in button and, when sign-in fails, a brief reason why.

/** Maps the `auth_error` query param value to a human-readable sentence. */
const authErrorMessages: Record<string, string> = {
  not_allowed: 'This Google account is not allowed. Sign in with the correct account.',
  denied: 'Sign-in was cancelled.',
};

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
  const authErrorMessage = authErrorMessages[authErrorKey] ?? null;

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
