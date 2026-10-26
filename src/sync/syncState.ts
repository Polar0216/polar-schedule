import type { ScheduleDatabase } from '../storage/database';
import type { SyncState } from './types';

// Pausing, clearing credentials or reauthorizing in another tab must win over a
// delayed network result. Never restore stale enabled/auth fields with a put.
export async function saveActiveState(db: ScheduleDatabase, state: SyncState): Promise<boolean> {
  return db.transaction('rw', db.syncStates, async () => {
    const current = await db.syncStates.get(state.key);
    if (!current?.enabled || current.authorizationId !== state.authorizationId) return false;
    await db.syncStates.put({ ...state, enabled: current.enabled, authorizationId: current.authorizationId }); return true;
  });
}

export async function withSyncLock<T>(db: ScheduleDatabase, key: string, action: () => Promise<T>): Promise<T | undefined> {
  if (globalThis.navigator?.locks) return navigator.locks.request(`polar-sync:${key}`, { ifAvailable: true }, (lock) => lock ? action() : undefined);
  const holder = crypto.randomUUID();
  const acquire = await db.transaction('rw', db.syncLeases, async () => {
    const current = await db.syncLeases.get(key);
    if (current && current.expires > Date.now()) return false;
    await db.syncLeases.put({ key, holder, expires: Date.now() + 60000 }); return true;
  });
  if (!acquire) return undefined;
  const timer = setInterval(() => { void db.transaction('rw', db.syncLeases, async () => {
    if ((await db.syncLeases.get(key))?.holder === holder) await db.syncLeases.put({ key, holder, expires: Date.now() + 60000 });
  }).catch(() => undefined); }, 15000);
  try { return await action(); }
  finally { clearInterval(timer); await db.transaction('rw', db.syncLeases, async () => {
    if ((await db.syncLeases.get(key))?.holder === holder) await db.syncLeases.delete(key);
  }); }
}
