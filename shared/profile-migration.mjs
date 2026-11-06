const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Keep legacy preferences before either process validates the new monthly profile. */
export function migrateLegacyProfile(value) {
  if (!record(value) || ![1, 2].includes(value.version)) return value;
  // Calendar refresh and privacy changes can create an old first-run document
  // before salary settings exist. Keep those top-level preferences too.
  const old = record(value.settings) ? value.settings : {};
  const settings = {
    monthlySalary: value.version === 1 && Number.isFinite(old.monthlySalary) && old.monthlySalary > 0
      && old.monthlySalary <= 1_000_000_000 ? old.monthlySalary : 0,
    currency: 'CNY', startTime: '09:00', endTime: '18:00', region: 'CN', autoWidget: true,
    dayOverrides: {}, lunchEnabled: false, lunchStart: '12:00', lunchEnd: '13:00',
    paydayMode: 'last-workday', payday: 1,
  };
  for (const key of ['currency', 'startTime', 'endTime', 'region', 'autoWidget', 'dayOverrides',
    'lunchEnabled', 'lunchStart', 'lunchEnd']) {
    if (Object.hasOwn(old, key)) settings[key] = old[key];
  }
  if (Object.hasOwn(old, 'payday')) {
    settings.payday = old.payday;
    settings.paydayMode = 'fixed-day';
  }
  // Old workday lists did not use the new holiday policy. Confirm the monthly rate
  // and calendar once; a daily amount is never converted using guessed workdays.
  return { ...value, version: 3, configured: false, settings };
}
