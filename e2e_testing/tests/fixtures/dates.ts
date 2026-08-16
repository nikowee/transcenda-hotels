/**
 * Stay dates for the specs, relative to the day the suite runs.
 *
 * SearchForm sets `min` on the check-in input to today + 3 days. Hardcoded
 * literals therefore have an expiry date: once `min` passes them the input goes
 * rangeUnderflow, the browser blocks submit before any JavaScript runs, and the
 * form-driven specs fail at their URL assertion while the negative ones pass
 * having asserted nothing.
 *
 * Local arithmetic, not toISOString(): that returns UTC, which is the previous
 * day here for most of the working day and would reintroduce an off-by-one.
 *
 * One shared pair across every spec, so they all key the same Redis search
 * entry and warm the cache for each other.
 */
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

export const CHECK_IN = daysFromNow(30);
export const CHECK_OUT = daysFromNow(35);

/** Before CHECK_IN, for the check-out-before-check-in negative case. */
export const CHECK_OUT_TOO_EARLY = daysFromNow(25);
