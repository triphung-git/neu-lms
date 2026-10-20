import { describe, it, expect } from 'vitest';
import type { RubricCriterion } from '../shared/kernel/types';

describe('NPC LMS Business Rules Validation', () => {
  describe('Rubric total score check', () => {
    it('correctly sums criteria maximum scores to 10.0', () => {
      const criteria: RubricCriterion[] = [
        {
          id: 'c1',
          title: 'Cấu trúc & Cú pháp',
          description: 'Chuẩn quy chuẩn',
          maxScore: 3.0,
        },
        {
          id: 'c2',
          title: 'Tính năng hoàn chỉnh',
          description: 'Chạy đúng toàn bộ',
          maxScore: 5.0,
        },
        {
          id: 'c3',
          title: 'Báo cáo & Trình bày',
          description: 'Đủ sơ đồ',
          maxScore: 2.0,
        },
      ];

      const total = criteria.reduce((sum, item) => sum + item.maxScore, 0);
      expect(total).toBeCloseTo(10.0, 2);
    });

    it('identifies invalid rubric sum', () => {
      const incompleteCriteria: RubricCriterion[] = [
        { id: 'c1', title: 'Phần 1', description: '', maxScore: 4.0 },
        { id: 'c2', title: 'Phần 2', description: '', maxScore: 5.0 },
      ];

      const total = incompleteCriteria.reduce((sum, item) => sum + item.maxScore, 0);
      expect(total).not.toEqual(10.0);
    });
  });

  describe('Late submission rules (D08)', () => {
    const dueAt = new Date('2026-10-20T23:59:00Z').getTime();
    const lateUntil = new Date('2026-10-23T23:59:00Z').getTime();

    it('marks submission on-time before dueAt', () => {
      const submitAt = new Date('2026-10-20T20:00:00Z').getTime();
      const isLate = submitAt > dueAt;
      const isAllowed = submitAt <= lateUntil;

      expect(isLate).toBe(false);
      expect(isAllowed).toBe(true);
    });

    it('marks submission late when between dueAt and lateUntil', () => {
      const submitAt = new Date('2026-10-21T10:00:00Z').getTime();
      const isLate = submitAt > dueAt;
      const isAllowed = submitAt <= lateUntil;

      expect(isLate).toBe(true);
      expect(isAllowed).toBe(true);
    });

    it('rejects submission past lateUntil', () => {
      const submitAt = new Date('2026-10-24T00:01:00Z').getTime();
      const isAllowed = submitAt <= lateUntil;

      expect(isAllowed).toBe(false);
    });
  });

  describe('Course Code Uppercase Rule (D03)', () => {
    it('normalizes course code to uppercase', () => {
      const input = 'it-3010-web';
      const normalized = input.trim().toUpperCase();
      expect(normalized).toBe('IT-3010-WEB');
      expect(/^[A-Z0-9_-]+$/.test(normalized)).toBe(true);
    });
  });

  describe('CSV Parsing Rule for Eligible Emails (D01)', () => {
    it('parses multi-line CSV with trim and header skip', () => {
      const rawCsv = `email,role,fullName,code
student1@neu.edu.vn,student,Nguyen Van A,NEU1001
TEACHER2@NEU.EDU.VN,teacher,Tran Thi B,GV2002
`;

      const lines = rawCsv.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      const rows = lines.slice(1).map((line) => {
        const [email, role, fullName, code] = line.split(',').map((p) => p.trim());
        return {
          emailNormalized: email.toLowerCase(),
          role,
          fullName,
          code,
        };
      });

      expect(rows.length).toBe(2);
      expect(rows[0].emailNormalized).toBe('student1@neu.edu.vn');
      expect(rows[1].emailNormalized).toBe('teacher2@neu.edu.vn');
      expect(rows[1].role).toBe('teacher');
    });
  });
});
