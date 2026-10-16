/** Joins class names, skipping falsy entries (for conditional Tailwind classes). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
