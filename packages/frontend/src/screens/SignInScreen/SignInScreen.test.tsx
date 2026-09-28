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

  it('shows a "not_allowed" error message when the query param is present', () => {
    const restore = stubLocation('?auth_error=not_allowed');
    render(<SignInScreen />);
    expect(screen.getByText(/This Google account is not allowed/)).toBeInTheDocument();
    restore();
  });

  it('shows a "denied" error message when the query param is present', () => {
    const restore = stubLocation('?auth_error=denied');
    render(<SignInScreen />);
    expect(screen.getByText(/Sign-in was cancelled/)).toBeInTheDocument();
    restore();
  });

  it('shows no error note when there is no auth_error param', () => {
    const restore = stubLocation('');
    render(<SignInScreen />);
    expect(screen.queryByText(/account is not allowed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
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
