import type { ScheduleDatabase } from '../storage/database';

// Implements prompt section 7A, only after the user checks Remember this device.
// Convenience mode stores a usable credential, not encrypted protection from XSS.
// The external temporary live-test PAT must never be passed to this browser vault.
export class CredentialVault {
  #session = new Map<string, { token: string; authorizationId: string }>();
  constructor(private readonly db: ScheduleDatabase) {}
  async set(key: string, token: string, remember: boolean, authorizationId: string) {
    await this.db.credentials.delete(key);
    if (remember) { await this.db.credentials.put({ key, token, mode: 'trusted', authorizationId }); this.#session.delete(key); }
    else this.#session.set(key, { token, authorizationId });
  }
  async get(key: string): Promise<string | undefined> {
    const state = await this.db.syncStates.get(key), session = this.#session.get(key);
    if (session && session.authorizationId !== state?.authorizationId) this.#session.delete(key);
    if (session?.authorizationId === state?.authorizationId) return session?.token;
    const credential = await this.db.credentials.get(key);
    return credential?.authorizationId === state?.authorizationId ? credential?.token : undefined;
  }
  async clear(key: string) { this.#session.delete(key); await this.db.credentials.delete(key); }
  forgetSession() { this.#session.clear(); }
}
