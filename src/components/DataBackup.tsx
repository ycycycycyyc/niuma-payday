import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, FolderOpen, ShieldCheck, Upload } from 'lucide-react';
import { MAX_PROFILE_BACKUP_BYTES, parseProfileBackup, profileRevision, type ProfileBackup, type ProfileRecovery } from '../../shared/profile-backup.mjs';
import { exportProfileBackup, getProfileRecovery, importProfileBackup, normalizeState, type AppState } from '../lib/store';
import { currencySymbol, money } from '../lib/clock';
import { describeDesktopError } from '../lib/desktop-error';
import './data-backup.css';

type Props = { state: AppState; onRestore: (state: AppState) => void };
type Selection = { backup: ProfileBackup; baseline: string; name: string };

export default function DataBackup({ state, onRestore }: Props) {
  const [recovery, setRecovery] = useState<ProfileRecovery | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const selectionId = useRef(0);
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    getProfileRecovery().then(value => { if (mounted.current) setRecovery(value); })
      .catch(value => { if (mounted.current) setError(describeDesktopError(value, 'read')); });
    return () => { mounted.current = false; selectionId.current++; };
  }, []);

  async function download() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const backup = await exportProfileBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Niuma-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('备份已生成，包含工资设置、排班与月度存钱记录。');
    } catch (value) { setError(describeDesktopError(value, '备份导出')); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const currentId = ++selectionId.current;
    setSelected(null); setConfirmed(false); setError(''); setNotice('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > MAX_PROFILE_BACKUP_BYTES) throw new Error('[BACKUP_INVALID] 备份文件超过 5 MB，请检查文件。');
      const backup = parseProfileBackup(await file.text());
      const baseline = profileRevision((await exportProfileBackup()).profile);
      if (mounted.current && currentId === selectionId.current) setSelected({ backup, baseline, name: file.name });
    } catch (value) {
      if (mounted.current && currentId === selectionId.current) setError(describeDesktopError(value, '备份读取'));
    } finally { if (mounted.current && currentId === selectionId.current) setBusy(false); }
  }

  async function restore() {
    if (!selected || !confirmed || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const restored = await importProfileBackup(selected.backup, selected.baseline);
      onRestore(restored);
      setSelected(null); setConfirmed(false);
      if (fileInput.current) fileInput.current.value = '';
      setRecovery({ status: 'normal', message: '备份已导入，导入前的有效资料保存在自动备份中。' });
      setNotice('已恢复工资设置、排班与月度存钱记录。');
    } catch (value) {
      setConfirmed(false);
      if (fileInput.current) fileInput.current.value = '';
      setError(describeDesktopError(value, '备份导入'));
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  const preview = selected ? normalizeState(selected.backup.profile) : null;
  return <section className="data-backup" aria-label="资料备份与恢复">
    {recovery && recovery.status !== 'normal' && <p className={`data-recovery ${recovery.status === 'blocked' ? 'blocked' : ''}`} role="status">{recovery.message}</p>}
    <details>
      <summary><ShieldCheck size={16} aria-hidden="true" />资料备份与恢复</summary>
      <div className="data-backup-body">
        <p>工资设置、排班和月度记录保存在本机。自动保留最近 3 次有效存档，也可以下载备份用于换机或恢复。</p>
        <div className="data-backup-actions">
          <button type="button" className="button secondary" onClick={() => void download()} disabled={busy}><Download size={15} />导出资料备份</button>
          <label className={`button secondary backup-file-button ${busy ? 'is-disabled' : ''}`}><FolderOpen size={15} aria-hidden="true" />选择备份文件
            <input ref={fileInput} type="file" accept=".json,application/json" aria-label="选择资料备份文件" disabled={busy} onChange={event => void chooseFile(event)} />
          </label>
        </div>
        <p className="data-backup-hint">备份文件含工资和存款金额，请保存在自己的设备中。游戏进度与浮窗外观单独保留。</p>
        {preview && selected && <div className="data-backup-preview" role="region" aria-label="待导入资料预览">
          <strong>核对待导入资料</strong><p className="data-backup-filename">{selected.name}</p>
          <dl>
            <div><dt>月薪</dt><dd>{state.privacy ? '••••' : !preview.configured ? '待确认工资设置' : `${currencySymbol(preview.settings.currency)}${money(preview.settings.monthlySalary)}`}</dd></div>
            <div><dt>月度记录</dt><dd>{Object.keys(preview.savings).length} 个月</dd></div>
            <div><dt>手动排班</dt><dd>{Object.keys(preview.settings.dayOverrides).length} 天</dd></div>
            <div><dt>备份时间</dt><dd>{selected.backup.createdAt ? new Date(selected.backup.createdAt).toLocaleString('zh-CN') : '旧版资料文件'}</dd></div>
          </dl>
          <label className="backup-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已核对，将用这份备份替换本机工资、排班和存钱记录。</label>
          <p className="data-backup-hint">导入前会保留现有的有效资料；预览后若有新记录保存，本次导入会停止。</p>
          <div className="data-backup-actions"><button type="button" className="button primary" disabled={!confirmed || busy} onClick={() => void restore()}><Upload size={15} />{busy ? '处理中…' : '确认导入备份'}</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => { selectionId.current++; setSelected(null); setConfirmed(false); if (fileInput.current) fileInput.current.value = ''; }}>取消导入</button></div>
        </div>}
        {notice && <p className="data-backup-notice" role="status">{notice}</p>}
        {error && <p className="data-backup-error" role="alert">{error}</p>}
      </div>
    </details>
  </section>;
}
