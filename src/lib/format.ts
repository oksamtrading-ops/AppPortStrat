/**
 * Shared date/time formatting — pure, no dependencies, safe in client and
 * server bundles alike.
 *
 * Everything renders in UTC via toISOString(). That's deliberate: the values
 * are timestamps whose exact ISO prefix is what the app displays, sorts, and
 * compares lexically (e.g. the tasks "overdue" check and the activity-feed day
 * grouping rely on YYYY-MM-DD string ordering). Do NOT switch these to
 * locale-aware formatting — it would shift dates across timezones and break
 * those comparisons. Previously these closures were copy-pasted across ~11
 * files; this is the single source of truth.
 */

/** "YYYY-MM-DD" (UTC). */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD HH:MM" (UTC). */
export function formatDateTime(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** "HH:MM" (UTC). */
export function formatTime(d: Date): string {
  return d.toISOString().slice(11, 16);
}

/** "YYYY-MM-DD HH:MM:SS" (UTC). */
export function formatDateTimeSeconds(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}
