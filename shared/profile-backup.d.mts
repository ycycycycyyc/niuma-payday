export type BackupProfile = { version: 3; configured: boolean; settings?: Record<string, any>; privacy?: boolean; goal?: { name: string; amount: number }; calendar?: Record<string, any>; savings?: Record<string, any> };
export type ProfileBackup = { format: 'niuma-payday-backup'; version: 1; createdAt: string | null; profile: BackupProfile };
export type ProfileRecovery = { status: 'normal' | 'preserved' | 'recovered' | 'blocked'; message: string };
export const PROFILE_BACKUP_FORMAT: string;
export const MAX_PROFILE_BACKUP_BYTES: number;
export function isProfileDocument(value: unknown, strictCollections?: boolean): value is BackupProfile;
export function profileRevision(profile: unknown): string;
export function createProfileBackup(profile: unknown, now?: Date): ProfileBackup;
export function parseProfileBackup(input: unknown): ProfileBackup;
export function createProfileFileStore(io: any, filename: string, options?: { validate?: (value: any) => boolean; now?: () => Date }): {
  load(): BackupProfile | null; save(value: unknown): void; status(): ProfileRecovery; backupName(index: number): string;
};
