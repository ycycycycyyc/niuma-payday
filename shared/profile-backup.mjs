import { isValidDateKey, isValidCalendarYear, normalizeCalendarCache } from './calendar.mjs';
import { isSavingsEntry, normalizeSavingsLedger } from './savings.mjs';
import { migrateLegacyProfile } from './profile-migration.mjs';

export const PROFILE_BACKUP_FORMAT = 'niuma-payday-backup';
export const MAX_PROFILE_BACKUP_BYTES = 5 * 1024 * 1024;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Shared by native recovery and portable imports; a calendar-only first run is valid. */
export function isProfileDocument(value, strictCollections = false) {
  if (!record(value) || value.version !== 3 || typeof value.configured !== 'boolean') return false;
  if (value.privacy !== undefined && typeof value.privacy !== 'boolean') return false;
  if (value.goal !== undefined && (!record(value.goal) || typeof value.goal.name !== 'string'
    || !value.goal.name.trim() || value.goal.name.length > 32 || !Number.isFinite(value.goal.amount)
    || value.goal.amount <= 0 || value.goal.amount > 100_000_000)) return false;
  if (strictCollections) {
    if (value.calendar !== undefined && (!record(value.calendar) || Object.entries(value.calendar).some(([key, year]) =>
      !isValidCalendarYear(year) || key !== `${year.region}-${year.year}`))) return false;
    if (value.savings !== undefined && (!record(value.savings) || Object.entries(value.savings).some(([key, entry]) =>
      !isSavingsEntry(entry) || key !== entry.month))) return false;
  }
  if (value.settings === undefined) return value.configured === false;
  const settings = value.settings;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!record(settings) || !Number.isFinite(settings.monthlySalary) || settings.monthlySalary < 0
    || (value.configured && settings.monthlySalary === 0) || settings.monthlySalary > 1_000_000_000
    || !['CNY', 'HKD', 'USD'].includes(settings.currency) || !['CN', 'HK'].includes(settings.region)
    || typeof settings.autoWidget !== 'boolean' || !['last-workday', 'fixed-day'].includes(settings.paydayMode)
    || typeof settings.lunchEnabled !== 'boolean' || !Number.isInteger(settings.payday)
    || settings.payday < 1 || settings.payday > 31 || !record(settings.dayOverrides)
    || Object.entries(settings.dayOverrides).some(([key, mode]) => !isValidDateKey(key) || !['work', 'rest'].includes(mode))
    || ['startTime', 'endTime', 'lunchStart', 'lunchEnd'].some(key => typeof settings[key] !== 'string' || !time.test(settings[key]))
    || settings.startTime === settings.endTime) return false;
  if (settings.lunchEnabled) {
    const minutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
    const start = minutes(settings.startTime);
    let end = minutes(settings.endTime);
    if (end <= start) end += 1440;
    let lunchStart = minutes(settings.lunchStart);
    if (lunchStart < start) lunchStart += 1440;
    let lunchEnd = minutes(settings.lunchEnd);
    while (lunchEnd <= lunchStart) lunchEnd += 1440;
    if (lunchEnd > end || lunchEnd - lunchStart >= end - start) return false;
  }
  return true;
}

function cleanProfile(profile) {
  const value = migrateLegacyProfile(profile);
  if (!isProfileDocument(value)) throw new Error('[BACKUP_INVALID] 资料格式无效，请选择牛马鼓励器的有效备份。');
  return {
    version: 3, configured: value.configured,
    ...(value.settings ? { settings: { ...value.settings, dayOverrides: { ...value.settings.dayOverrides } } } : {}),
    ...(value.goal ? { goal: { ...value.goal } } : {}),
    privacy: value.privacy === true,
    calendar: normalizeCalendarCache(value.calendar), savings: normalizeSavingsLedger(value.savings),
  };
}

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** Exact canonical comparison rather than a short hash: concurrent imports cannot collide. */
export function profileRevision(profile) {
  return JSON.stringify(canonical(cleanProfile(profile ?? { version: 3, configured: false })));
}

export function createProfileBackup(profile, now = new Date()) {
  return { format: PROFILE_BACKUP_FORMAT, version: 1, createdAt: now.toISOString(), profile: cleanProfile(profile ?? { version: 3, configured: false }) };
}

export function parseProfileBackup(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_PROFILE_BACKUP_BYTES) throw new Error('[BACKUP_INVALID] 备份文件超过 5 MB，请检查文件。');
    try { input = JSON.parse(input.replace(/^\uFEFF/, '')); }
    catch { throw new Error('[BACKUP_INVALID] 无法读取 JSON，请选择完整的备份文件。'); }
  }
  if (!record(input)) throw new Error('[BACKUP_INVALID] 备份文件格式无效。');
  const envelope = input.format !== undefined;
  if (envelope && (input.format !== PROFILE_BACKUP_FORMAT || input.version !== 1
    || (input.createdAt !== null && (typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt)))))) {
    throw new Error('[BACKUP_INVALID] 不支持这个备份版本。');
  }
  const raw = envelope ? input.profile : input;
  if (!record(raw) || ![1, 2, 3].includes(raw.version)) throw new Error('[BACKUP_INVALID] 请选择牛马鼓励器的资料备份。');
  const migrated = migrateLegacyProfile(raw);
  if (!isProfileDocument(migrated, true)) throw new Error('[BACKUP_INVALID] 备份中的工资、日期或账本不完整，未导入任何资料。');
  return { format: PROFILE_BACKUP_FORMAT, version: 1, createdAt: envelope ? input.createdAt : null, profile: cleanProfile(migrated) };
}

/** Filesystem is injected so recovery is tested in isolated directories and never imports Node into the renderer. */
export function createProfileFileStore(io, filename, options = {}) {
  const validate = options.validate ?? isProfileDocument;
  const now = options.now ?? (() => new Date());
  const backupName = index => `${filename}.backup-${index}`;
  let loaded = false;
  let recovery = { status: 'normal', message: '资料保存在本机，自动保留最近 3 次有效存档。' };
  let quarantinedText;

  const read = file => {
    try {
      const text = io.readFileSync(file, 'utf8');
      let value;
      try { value = migrateLegacyProfile(JSON.parse(text)); } catch { return { text, invalid: true }; }
      return validate(value) ? { text, value } : { text, invalid: true };
    } catch (error) {
      if (error.code === 'ENOENT') return { missing: true };
      throw error;
    }
  };
  function quarantine(text) {
    if (text === quarantinedText) return;
    const name = `${filename}.corrupt-${now().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      // Use the bytes already read; a source modified during recovery must not erase this evidence.
      io.writeFileSync(name, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      quarantinedText = text;
      recovery = { status: 'preserved', message: '检测到资料异常，原文件已单独保留。可导入备份，或重新填写工资设置。' };
    } catch {
      recovery = { status: 'blocked', message: '资料异常且无法保留原文件。请检查应用数据目录权限；恢复前不会覆盖现有资料。' };
      throw new Error('[PROFILE_RECOVERY_REQUIRED] 无法保留异常资料，已停止写入。');
    }
  }
  function load() {
    let current;
    try { current = read(filename); }
    catch {
      loaded = true;
      recovery = { status: 'blocked', message: '无法读取现有资料，已停止写入。请检查应用数据目录的读写权限，再重新打开应用。' };
      return null;
    }
    loaded = true;
    if (current.value) return current.value;
    if (!current.missing) { try { quarantine(current.text); } catch { return null; } }
    for (let index = 1; index <= 3; index++) {
      try {
        const backup = read(backupName(index));
        if (backup.value) {
          recovery = { status: 'recovered', message: current.missing ? '资料文件缺失，已恢复最近一次有效存档。请核对工资与月度记录。'
            : '异常原文件已保留，已恢复最近一次有效存档。请核对工资与月度记录。' };
          return backup.value;
        }
      } catch { /* Try another retained snapshot without replacing the original. */ }
    }
    return null;
  }
  function save(value) {
    if (!validate(value)) throw new Error('[SETTINGS_INVALID] 资料格式无效，未保存。');
    if (!loaded) load();
    if (recovery.status === 'blocked') load();
    if (recovery.status === 'blocked') throw new Error('[PROFILE_RECOVERY_REQUIRED] 原资料尚未保护，已停止写入。');
    const current = read(filename);
    if (current.invalid) quarantine(current.text);
    const text = JSON.stringify(value);
    if (current.text === text) return;
    const temporary = `${filename}.tmp`;
    io.writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 });
    // Rotate only valid snapshots. A corrupt source can never replace a healthy backup.
    if (current.value) {
      for (let index = 3; index >= 2; index--) {
        const previous = read(backupName(index - 1));
        if (previous.value) io.writeFileSync(backupName(index), previous.text, { encoding: 'utf8', mode: 0o600 });
      }
      io.writeFileSync(backupName(1), current.text, { encoding: 'utf8', mode: 0o600 });
    }
    io.renameSync(temporary, filename);
    if (io.readFileSync(filename, 'utf8') !== text) throw new Error('[NIUMA_WRITE_UNCONFIRMED] 无法确认写入后的资料。');
  }
  return { load, save, status: () => ({ ...recovery }), backupName };
}
