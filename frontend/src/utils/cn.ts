import clsx, { type ClassValue } from 'clsx';

/** Tiny class-name helper (clsx with no runtime overhead beyond clsx itself). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
