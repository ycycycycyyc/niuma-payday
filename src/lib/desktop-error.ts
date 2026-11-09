const operationNames: Record<string, string> = { save: '设置未保存', read: '设置未能读取', widget: '浮窗未打开', window: '窗口操作未完成', calendar: '日历未更新' };

/** The Electron user agent remains available if its preload fails before exposing the bridge. */
export function isDesktopHost(): boolean {
  return Boolean(globalThis.window?.niuma || /\bElectron\/\d/i.test(globalThis.window?.navigator?.userAgent ?? ''));
}

export function describeDesktopError(error: unknown, operation: string = 'window'): string {
  const prefix = operationNames[operation] ?? (operation + '未完成');
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message) : typeof error === 'string' ? error : '';
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^(?:Error:\s*)+/i, '').trim();
  let detail: string;
  if (/\[BACKUP_CONFLICT\]/.test(message)) {
    detail = '预览期间本机资料已更新。请重新选择备份并核对，避免覆盖刚保存的记录。';
  } else if (/\[PROFILE_RECOVERY_REQUIRED\]/.test(message)) {
    detail = '原资料异常且尚未成功保留，已停止覆盖写入。请检查本机存储空间及读写权限，再重新打开应用。';
  } else if (/\[BACKUP_INVALID\]/.test(message)) {
    detail = message.replace(/^\[BACKUP_INVALID\]\s*/, '');
  } else if (/NIUMA_BRIDGE_MISSING|No handler registered|is not a function|Cannot read properties of undefined/i.test(message)) {
    detail = '桌面组件未正确连接。请从系统托盘退出后，重新打开同一版本的完整应用。';
  } else if (/not authorized|unauthori[sz]ed|NIUMA_UNTRUSTED|\[WINDOW_NOT_TRUSTED\]/i.test(message)) {
    detail = '桌面端未识别当前窗口。请从系统托盘退出，再重新打开应用。';
  } else if (/NIUMA_WRITE_UNCONFIRMED/.test(message)) {
    return '无法确认设置是否已保存：桌面端未返回与本次输入一致的设置。请重试；如果仍然失败，请完全退出后重新打开。';
  } else if (/NIUMA_READ_UNCONFIRMED/.test(message)) {
    detail = '桌面端未返回可核对的设置。请重试；如果仍然失败，请完全退出后重新打开。';
  } else if (/\b(ENOSPC|EDQUOT|SAVE_SPACE)\b|QuotaExceededError|exceeded the quota/i.test(message)) {
    detail = '存储空间不足。请释放空间后重试。';
  } else if (/\b(EBUSY|ETXTBSY)\b|resource busy|file is in use/i.test(message)) {
    detail = '设置文件正被占用。请关闭其他实例或正在使用该文件的程序后重试。';
  } else if (/\b(EACCES|EPERM|EROFS|SAVE_PERMISSION)\b|access (?:is )?denied|拒绝访问|SecurityError/i.test(message)) {
    detail = '系统拒绝了文件访问。请检查应用数据目录的读写权限，以及文件是否被其他程序占用。';
  } else if (/Settings are (?:invalid|too large)|Settings must be an object|\[SETTINGS_INVALID\]/i.test(message)) {
    detail = '桌面端未接受这组设置。请检查输入，确认正在使用同一版本的应用后重试。';
  } else if (/\[SAVE_FAILED\]/.test(message)) {
    detail = '本机数据文件写入失败。请检查磁盘及数据目录后重试。';
  } else if (/\[WIDGET_FAILED\]/.test(message)) {
    detail = '桌面端无法创建小窗。请完全退出应用，重新打开后再试。';
  } else if (/ERR_FILE_NOT_FOUND|ERR_FAILED|failed to load URL|could not be loaded/i.test(message)) {
    detail = '应用资源未能载入。请确认已完整解压或安装应用，再重新打开。';
  } else {
    detail = message ? '原因：' + message.replace(/\s+/g, ' ').slice(0, 180) : '没有收到具体原因，请重试。';
  }
  return prefix + '：' + detail;
}
