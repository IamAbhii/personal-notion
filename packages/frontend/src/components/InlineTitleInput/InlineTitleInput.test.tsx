import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineTitleInput, type InlineTitleInputProps } from './InlineTitleInput';

function renderInput(overrides: Partial<InlineTitleInputProps> = {}) {
  const props: InlineTitleInputProps = {
    value: 'Reading list',
    ariaLabel: 'New name for Reading list',
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(
    <div>
      <button type="button">Elsewhere</button>
      <InlineTitleInput {...props} />
    </div>,
  );
  return props;
}

describe('InlineTitleInput', () => {
  it('commits exactly once when Enter is followed by a blur', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, 'To read{Enter}');
    // The parent may keep the input mounted for a tick; the blur that follows must not write again.
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith('To read');
  });

  it('commits exactly once when the edit ends with a blur and no Enter', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, 'To read');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith('To read');
  });

  it('writes nothing when the title is committed unchanged', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    await user.type(screen.getByLabelText('New name for Reading list'), '{Enter}');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when only surrounding whitespace changed', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, '  Reading list  ');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels once on Escape and does not commit on the blur that follows', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, 'To read{Escape}');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a blank title visibly instead of discarding the edit silently (DEF-010)', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, '   {Enter}');

    expect(props.onCommit).not.toHaveBeenCalled();
    // The edit stays open with the reason on screen: closing silently is indistinguishable from a
    // lost write, which is the defect.
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('A page needs a name');
    expect(input).toHaveValue('Reading list');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the refusal once the user types again', async () => {
    const user = userEvent.setup();
    renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.type(input, '{Enter}');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(input, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes a blank edit on blur, which puts the old title back on screen', async () => {
    const user = userEvent.setup();
    const props = renderInput();

    const input = screen.getByLabelText('New name for Reading list');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('caps the title at the 500 characters the server accepts', () => {
    renderInput();

    expect(screen.getByLabelText('New name for Reading list')).toHaveAttribute('maxlength', '500');
  });
});
