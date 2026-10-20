import { createInitialSeed, type DatabaseState } from '../mock/mockDatabase';

const STORAGE_NAMESPACE = 'npc-lms-demo:v1';
const SESSION_NAMESPACE = 'npc-lms-demo:session';

export interface StoredSession {
  userId: string;
  role: 'admin' | 'teacher' | 'student';
  fullName: string;
  email: string;
  token?: string;
}

class StorageManager {
  private inMemoryDb: DatabaseState | null = null;
  private isStorageRestricted: boolean = false;
  private listeners: Set<(db: DatabaseState) => void> = new Set();

  public isMemoryOnly(): boolean {
    return this.isStorageRestricted;
  }

  public getDatabase(): DatabaseState {
    if (this.inMemoryDb) {
      return this.inMemoryDb;
    }

    try {
      const raw = localStorage.getItem(STORAGE_NAMESPACE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const seed = createInitialSeed();
          // Ensure all required collections exist, backfilling missing ones from seed
          const collections: (keyof DatabaseState)[] = [
            'users',
            'validEmails',
            'courses',
            'memberships',
            'chapters',
            'lessons',
            'materials',
            'materialVersions',
            'assignments',
            'submissions',
            'gradeRevisions',
            'announcements',
            'emailJobs',
            'aiDrafts',
            'auditLogs'
          ];

          let needsResave = false;
          for (const key of collections) {
            if (!Array.isArray(parsed[key])) {
              parsed[key] = seed[key] as any;
              needsResave = true;
            }
          }

          if (!parsed.settings || typeof parsed.settings !== 'object') {
            parsed.settings = seed.settings;
            needsResave = true;
          }

          this.inMemoryDb = parsed as DatabaseState;
          if (needsResave) {
            this.saveDatabase(this.inMemoryDb);
          }
          return this.inMemoryDb;
        }
      }
    } catch (err) {
      console.warn('LocalStorage unavailable or corrupt, falling back to memory state:', err);
      this.isStorageRestricted = true;
    }

    // Initialize fresh seed
    const seed = createInitialSeed();
    this.inMemoryDb = seed;
    this.saveDatabase(seed);
    return seed;
  }

  public saveDatabase(db: DatabaseState): void {
    this.inMemoryDb = db;
    if (!this.isStorageRestricted) {
      try {
        localStorage.setItem(STORAGE_NAMESPACE, JSON.stringify(db));
      } catch (err) {
        console.warn('Failed to write to localStorage. Switching to in-memory mode:', err);
        this.isStorageRestricted = true;
      }
    }
    this.notify();
  }

  public resetDatabase(): DatabaseState {
    try {
      localStorage.removeItem(STORAGE_NAMESPACE);
      this.clearSession();
    } catch {
      // ignore
    }
    const seed = createInitialSeed();
    this.inMemoryDb = seed;
    this.saveDatabase(seed);
    return seed;
  }

  public getSession(): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_NAMESPACE);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // fallback
    }
    return null;
  }

  public saveSession(session: StoredSession): void {
    try {
      sessionStorage.setItem(SESSION_NAMESPACE, JSON.stringify(session));
    } catch {
      // ignore
    }
  }

  public clearSession(): void {
    try {
      sessionStorage.removeItem(SESSION_NAMESPACE);
    } catch {
      // ignore
    }
  }

  public subscribe(listener: (db: DatabaseState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (this.inMemoryDb) {
      this.listeners.forEach((l) => l(this.inMemoryDb!));
    }
  }
}

export const storageManager = new StorageManager();
