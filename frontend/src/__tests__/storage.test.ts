import { describe, it, expect, beforeEach } from 'vitest';
import { storageManager } from '../infrastructure/persistence/storage';

describe('Storage Manager with In-Memory Fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('safely initializes and gets database state', () => {
    const db = storageManager.getDatabase();
    expect(db).toBeDefined();
    expect(db.users.length).toBeGreaterThan(0);
    expect(db.courses.length).toBeGreaterThan(0);
  });

  it('saves modified database state and retrieves it', () => {
    const db = storageManager.getDatabase();
    const modified = {
      ...db,
      courses: [
        ...db.courses,
        {
          id: 'test-course-999',
          code: 'TEST999',
          name: 'Khoá học kiểm thử',
          term: 'HK1-2026',
          description: 'Khoá học kiểm thử mô tả',
          teacherId: 'u-teacher-01',
          status: 'open' as const,
        },
      ],
    };

    storageManager.saveDatabase(modified);
    const retrieved = storageManager.getDatabase();
    expect(retrieved.courses.some((c) => c.id === 'test-course-999')).toBe(true);
  });

  it('manages session safely', () => {
    expect(storageManager.getSession()).toBeNull();

    storageManager.saveSession({
      userId: 'u-test-1',
      role: 'student',
      fullName: 'Sinh viên Test',
      email: 'test@neu.edu.vn',
    });

    const session = storageManager.getSession();
    expect(session).toBeDefined();
    expect(session?.userId).toBe('u-test-1');
    expect(session?.role).toBe('student');

    storageManager.clearSession();
    expect(storageManager.getSession()).toBeNull();
  });

  it('resets database to seed successfully', () => {
    const reset = storageManager.resetDatabase();
    expect(reset).toBeDefined();
    expect(reset.users.length).toBeGreaterThan(0);
  });
});
