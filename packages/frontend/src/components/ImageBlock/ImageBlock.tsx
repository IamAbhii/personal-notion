/** Renders an image block pasted from the clipboard. The src is a base64 data URL. */
export interface ImageBlockProps {
  /** The base64 data URL of the image, as read from the clipboard via FileReader. */
  src: string;
  /** Accessible description; defaults to empty because decorative screenshots have no caption. */
  alt?: string;
}

/**
 * A read-only image block: shows the pasted image constrained to the column width.
 * Deletion goes through the existing block-actions menu on the gutter handle.
 */
export function ImageBlock({ src, alt = '' }: ImageBlockProps) {
  return <img src={src} alt={alt} className="max-w-full rounded-md" data-testid="block-image" />;
}
