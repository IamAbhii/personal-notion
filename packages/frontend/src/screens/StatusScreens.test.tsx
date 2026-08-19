import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppError, AppLoading, NoWorkspace } from './StatusScreens';
import { ApiError } from '../api/client';

// A reload with no network used to show the raw fetch text ("Failed to fetch"), which reads as a bug
// in the app rather than a missing connection (DEF-006).

describe('AppError', () => {
  it('says the user is offline instead of showing the raw fetch error', () => {
    render(<AppError error={new TypeError('Failed to fetch')} />);

    expect(screen.getByText('You are offline')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reports an API refusal with its status, which is not an offline case', () => {
    render(<AppError error={new ApiError(403, 'forbidden')} />);

    expect(screen.getByText('The server refused the request')).toBeInTheDocument();
    expect(screen.getByText('403: forbidden')).toBeInTheDocument();
  });

  it('falls back to the error text for anything else', () => {
    render(<AppError error={new Error('snapshot parse failed')} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('snapshot parse failed')).toBeInTheDocument();
  });
});

describe('AppLoading', () => {
  it('renders the loading message', () => {
    render(<AppLoading />);
    expect(screen.getByText(/loading your workspace/i)).toBeInTheDocument();
  });

  it('renders the Personal Space eyebrow', () => {
    render(<AppLoading />);
    expect(screen.getByText('Personal Space')).toBeInTheDocument();
  });
});

describe('NoWorkspace', () => {
  it('renders the no-workspace message', () => {
    render(<NoWorkspace />);
    expect(screen.getByText(/you do not belong to a workspace yet/i)).toBeInTheDocument();
  });

  it('renders a hint about how to get access', () => {
    render(<NoWorkspace />);
    expect(screen.getByText(/invitation/i)).toBeInTheDocument();
  });
});
