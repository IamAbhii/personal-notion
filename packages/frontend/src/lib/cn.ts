import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Composes conditional class names and resolves conflicting Tailwind utilities, last one winning.
 * Use for every className that has a condition in it or accepts an incoming className prop.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
