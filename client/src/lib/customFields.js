/** Custom field values in forms (definitions come from useCustomFields). */

/** Form state for a record's custom field values: the same keys, as strings. */
export const customFieldState = (values) =>
  Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)]));

/**
 * What to send as `customFields`: on create the filled-in values; on edit the
 * changed ones, with a cleared value sent as null. Undefined when nothing to send.
 */
export function customFieldPayload(state, original = null) {
  const before = customFieldState(original);
  const entries = Object.entries(state).filter(([key, value]) => (original ? value !== (before[key] ?? '') : value !== ''));
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, value === '' ? null : value]));
}
