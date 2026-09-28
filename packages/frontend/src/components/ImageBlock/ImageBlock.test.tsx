import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ImageBlock } from './ImageBlock';

describe('ImageBlock', () => {
  it('renders an img element with the given src', () => {
    const src = 'data:image/png;base64,abc123';
    render(<ImageBlock src={src} />);
    const img = document.querySelector('[data-testid="block-image"]') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(src);
  });

  it('uses an empty alt by default', () => {
    render(<ImageBlock src="data:image/png;base64,x" />);
    const img = document.querySelector('[data-testid="block-image"]') as HTMLImageElement;
    expect(img.alt).toBe('');
  });

  it('forwards a provided alt attribute', () => {
    render(<ImageBlock src="data:image/png;base64,x" alt="A screenshot" />);
    const img = document.querySelector('[data-testid="block-image"]') as HTMLImageElement;
    expect(img.alt).toBe('A screenshot');
  });
});
