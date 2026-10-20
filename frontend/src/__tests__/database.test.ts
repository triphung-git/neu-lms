import { describe, it, expect } from 'vitest';
import { createInitialSeed } from '../infrastructure/mock/mockDatabase';

describe('Seed Mock Database Baseline', () => {
  const seed = createInitialSeed();

  it('contains expected deterministic users (admin, teacher, student)', () => {
    expect(seed.users.length).toBeGreaterThanOrEqual(3);

    const admin = seed.users.find((u) => u.role === 'admin');
    const teacher = seed.users.find((u) => u.role === 'teacher');
    const student = seed.users.find((u) => u.role === 'student');

    expect(admin).toBeDefined();
    expect(teacher).toBeDefined();
    expect(student).toBeDefined();

    expect(admin?.emailNormalized).toBe('quan-tri@example.edu.vn');
    expect(teacher?.emailNormalized).toBe('giang-vien@example.edu.vn');
    expect(student?.emailNormalized).toBe('sinh-vien@example.edu.vn');
  });

  it('contains open courses with expected code format and term', () => {
    expect(seed.courses.length).toBeGreaterThan(0);
    const openCourse = seed.courses.find((c) => c.status === 'open');
    expect(openCourse).toBeDefined();
    expect(openCourse?.code).toBe(openCourse?.code.toUpperCase());
    expect(openCourse?.term).toMatch(/HK\d/);
  });

  it('contains valid emails whitelist with pending registrations', () => {
    expect(seed.validEmails.length).toBeGreaterThan(0);
    const pending = seed.validEmails.find((e) => !e.registeredUserId);
    expect(pending).toBeDefined();
  });

  it('contains audit logs with actor and ISO timestamp', () => {
    expect(seed.auditLogs.length).toBeGreaterThan(0);
    const log = seed.auditLogs[0];
    expect(log.actorRole).toBeDefined();
    expect(log.action).toBeDefined();
    expect(log.at).toBeDefined();
  });
});
