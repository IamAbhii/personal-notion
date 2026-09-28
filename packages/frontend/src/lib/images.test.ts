import { describe, it, expect, vi, afterEach } from 'vitest';
import { compressPastedImage, IMAGE_MAX_EDGE_PX, IMAGE_PNG_SIZE_THRESHOLD_BYTES } from './images';

// jsdom does not implement real canvas pixel encoding, so we stub the canvas API to verify the
// scaling maths and the PNG-then-JPEG fallback decision without real pixel output.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Builds a mock canvas whose toDataURL returns a controllable string. */
function makeCanvasMock(pngDataUrl: string) {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataUrl: undefined as unknown,
    toDataURL: vi.fn((type?: string) => {
      if (type === 'image/jpeg') return 'data:image/jpeg;base64,JPEG';
      return pngDataUrl;
    }),
  };
  return { canvas, ctx };
}

/**
 * Stubs document.createElement so that creating a 'canvas' returns the mock canvas, and stubs
 * URL.createObjectURL / revokeObjectURL so no real Blob wiring is needed.
 */
function stubCanvas(pngDataUrl: string) {
  const { canvas, ctx } = makeCanvasMock(pngDataUrl);
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
    return originalCreateElement(tag);
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
  return { canvas, ctx };
}

/**
 * Stubs the global Image constructor so that setting .src triggers .onload with the given
 * dimensions. Uses vi.stubGlobal because jsdom's Image is not a spy-able enumerable on globalThis.
 */
function stubImage(naturalWidth: number, naturalHeight: number) {
  // Track the instance so tests can inspect it.
  const instances: {
    naturalWidth: number;
    naturalHeight: number;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  }[] = [];

  function MockImage(this: {
    naturalWidth: number;
    naturalHeight: number;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    _src: string;
  }) {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.onload = null;
    this.onerror = null;
    this._src = '';
    instances.push(this);
  }

  Object.defineProperty(MockImage.prototype, 'src', {
    set(this: { onload: (() => void) | null }) {
      // Trigger load on next microtask to simulate async image decode. The src value is not
      // needed here — the stub always resolves with the pre-configured dimensions.
      Promise.resolve().then(() => this.onload?.());
    },
    configurable: true,
  });

  vi.stubGlobal('Image', MockImage);
  return instances;
}

// ── scaling maths ──────────────────────────────────────────────────────────────

describe('compressPastedImage — scaling', () => {
  it('does not upscale an image smaller than IMAGE_MAX_EDGE_PX', async () => {
    stubImage(400, 300);
    const { canvas } = stubCanvas('data:image/png;base64,SMALL');

    await compressPastedImage(new Blob(['x'], { type: 'image/png' }));

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
  });

  it('scales a landscape image so the longest edge equals IMAGE_MAX_EDGE_PX', async () => {
    // 3200x2400 landscape — longest edge is 3200, scale = 1600/3200 = 0.5
    stubImage(3200, 2400);
    const { canvas } = stubCanvas('data:image/png;base64,SCALED');

    await compressPastedImage(new Blob(['x'], { type: 'image/png' }));

    expect(canvas.width).toBe(IMAGE_MAX_EDGE_PX);
    expect(canvas.height).toBe(1200);
  });

  it('scales a portrait image so the longest edge equals IMAGE_MAX_EDGE_PX', async () => {
    // 2000x4000 portrait — longest edge is 4000, scale = 1600/4000 = 0.4
    stubImage(2000, 4000);
    const { canvas } = stubCanvas('data:image/png;base64,PORTRAIT');

    await compressPastedImage(new Blob(['x'], { type: 'image/png' }));

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(IMAGE_MAX_EDGE_PX);
  });

  it('revokes the object URL after processing', async () => {
    stubImage(100, 100);
    stubCanvas('data:image/png;base64,OK');

    await compressPastedImage(new Blob(['x'], { type: 'image/png' }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});

// ── PNG vs JPEG fallback ───────────────────────────────────────────────────────

describe('compressPastedImage — PNG-then-JPEG fallback', () => {
  it('returns the PNG data URL when it is under the size threshold', async () => {
    stubImage(100, 100);
    const smallPng = 'data:image/png;base64,' + 'A'.repeat(10);
    const { canvas } = stubCanvas(smallPng);

    const result = await compressPastedImage(new Blob(['x'], { type: 'image/png' }));

    expect(result).toBe(smallPng);
    expect(canvas.toDataURL).not.toHaveBeenCalledWith('image/jpeg', expect.anything());
  });

  it('falls back to JPEG when the PNG data URL exceeds IMAGE_PNG_SIZE_THRESHOLD_BYTES', async () => {
    stubImage(100, 100);
    // Build a PNG data URL longer than the threshold.
    const largePng = 'data:image/png;base64,' + 'A'.repeat(IMAGE_PNG_SIZE_THRESHOLD_BYTES + 1);
    const { canvas } = stubCanvas(largePng);

    const result = await compressPastedImage(new Blob(['x'], { type: 'image/png' }));

    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
    expect(result).toBe('data:image/jpeg;base64,JPEG');
  });
});
