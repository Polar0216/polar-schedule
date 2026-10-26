import type { ScheduleData } from '../domain/schema';

export type SyncEnvironment = 'test' | 'production';
export interface SyncTarget { environment: SyncEnvironment; owner: string; repo: string; branch: string; path: string }
export const TEST_TARGET: SyncTarget = { environment: 'test', owner: 'Polar0216', repo: 'polar-schedule-data-test', branch: 'main', path: 'data/polar-schedule.json' };
export const PRODUCTION_TARGET: SyncTarget = { ...TEST_TARGET, environment: 'production', repo: 'polar-schedule-data' };
export function targetFor(environment: SyncEnvironment): SyncTarget {
  if (environment !== 'test' && environment !== 'production') throw new Error('无效的同步环境');
  return { ...(environment === 'production' ? PRODUCTION_TARGET : TEST_TARGET) };
}
export function targetKey(target: SyncTarget): string {
  return JSON.stringify([target.environment, target.owner, target.repo, target.branch, target.path]);
}
export interface RemoteFile { data: ScheduleData; sha: string }
export interface Conflict { key: string; kind: string; title: string; local: unknown; remote: unknown }
export type Choices = Record<string, 'local' | 'remote'>;
export interface SyncPreview {
  kind: 'first' | 'conflict'; local: ScheduleData; remote: ScheduleData | null; sha: string | null;
  conflicts: Conflict[]; upload: number; download: number;
}
export interface SyncState {
  key: string; target: SyncTarget; enabled: boolean; base?: ScheduleData; sha?: string;
  lastSyncedAt?: string; preview?: SyncPreview; inflight?: ScheduleData; inflightLocal?: ScheduleData;
  authorizationId?: string;
  selected?: boolean;
  error?: string; retryAt?: number; authExpired?: boolean;
}
export interface Credential { key: string; token: string; mode: 'trusted'; authorizationId: string }
export interface SyncLease { key: string; holder: string; expires: number }
export type SyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'preview' | 'conflict' | 'offline' | 'error' | 'auth';
export interface SyncView { status: SyncStatus; pending: number; state: SyncState | null; connected: boolean; target: SyncTarget }
