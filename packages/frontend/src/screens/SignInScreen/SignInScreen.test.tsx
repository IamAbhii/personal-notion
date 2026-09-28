import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInScreen } from './SignInScreen';

// Helpers to stub window.location and history for tests that read the URL or clean it.

function stubLocation(search: string) {
  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...original,
      search,
      pathname: '/',
      hash: '',
      href: '',
    },
  });
  return () => Object.defineProperty(window, 'location', { configurable: true, value: original });
}

describe('SignInScreen', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the sign-in button', () => {
    render(<SignInScreen />);
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('shows the app name in the eyebrow', () => {
    render(<SignInScreen />);
    expect(screen.getByText('Personal Space')).toBeInTheDocument();
  });

  it('navigates to /api/auth/google when the sign-in button is clicked', async () => {
    const user = userEvent.setup();
    const restoreLocation = stubLocation('');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, href: '' },
    });
    render(<SignInScreen />);
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(window.location.href).toBe('/api/auth/google');
    restoreLocation();
  });

  it('shows the correct message for the "denied" code', () => {
    const restore = stubLocation('?auth_error=denied');
    render(<SignInScreen />);
    expect(screen.getByText(/Sign-in was cancelled/)).toBeInTheDocument();
    restore();
  });

  it('shows the correct message for the "not_allowed" code', () => {
    const restore = stubLocation('?auth_error=not_allowed');
    render(<SignInScreen />);
    expect(screen.getByText(/does not have access to this space/)).toBeInTheDocument();
    restore();
  });

  it('shows the correct message for the "email_unverified" code', () => {
    const restore = stubLocation('?auth_error=email_unverified');
    render(<SignInScreen />);
    expect(screen.getByText(/email address is not verified/)).toBeInTheDocument();
    restore();
  });

  it('shows the correct message for the "expired" code', () => {
    const restore = stubLocation('?auth_error=expired');
    render(<SignInScreen />);
    expect(screen.getByText(/timed out or was interrupted/)).toBeInTheDocument();
    restore();
  });

  it('shows the correct message for the "no_code" code', () => {
    const restore = stubLocation('?auth_error=no_code');
    render(<SignInScreen />);
    expect(screen.getByText(/Google did not complete the sign-in/)).toBeInTheDocument();
    restore();
  });

  it('shows the correct message for the "provider_error" code', () => {
    const restore = stubLocation('?auth_error=provider_error');
    render(<SignInScreen />);
    expect(screen.getByText(/server-side problem/)).toBeInTheDocument();
    restore();
  });

  it('shows the fallback message for an unrecognised code', () => {
    const restore = stubLocation('?auth_error=something_unknown');
    render(<SignInScreen />);
    expect(screen.getByText(/Sign-in did not complete/)).toBeInTheDocument();
    restore();
  });

  it('shows no error note and no error intent when there is no auth_error param', () => {
    const restore = stubLocation('');
    render(<SignInScreen />);
    // No note paragraph should contain error-related text
    expect(screen.queryByText(/Sign-in did not complete/)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not have access/)).not.toBeInTheDocument();
    expect(screen.queryByText(/timed out/)).not.toBeInTheDocument();
    // Eyebrow must not carry the error (danger-fg) class
    const eyebrow = screen.getByText('Personal Space');
    expect(eyebrow).not.toHaveClass('text-danger-fg');
    restore();
  });

  it('calls history.replaceState to clean the URL when auth_error is present', () => {
    const restore = stubLocation('?auth_error=denied');
    render(<SignInScreen />);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/');
    restore();
  });

  it('does not call history.replaceState when there is no auth_error param', () => {
    const restore = stubLocation('');
    render(<SignInScreen />);
    expect(replaceStateSpy).not.toHaveBeenCalled();
    restore();
  });
});
