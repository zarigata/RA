/** Single source of truth for RA version string.
 *  Stardate scheme: (year−2000)·1000 + dayOfYear/365.25·1000, fixed 1 decimal.
 *  Monotonic and sortable across years (even leap-year day 366 stays under the
 *  next Jan 1). Computed in UTC so the value is deterministic. */
export function stardate(date: Date): string {
  const year = date.getUTCFullYear();
  const dayOfYear =
    Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return ((year - 2000) * 1000 + (dayOfYear / 365.25) * 1000).toFixed(1);
}

/** Version shown by CLI/TUI — stardate of the day RA was launched. */
export const RA_VERSION = stardate(new Date());
