/**
 * Shared slugify helper for converting document titles to filenames.
 */

/** Slugify a title to a safe kebab-case filename. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
