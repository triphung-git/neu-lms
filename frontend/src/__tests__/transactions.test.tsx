import { describe, it, expect, beforeEach } from 'vitest';
import { storageManager } from '../infrastructure/persistence/storage';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { DatabaseProvider, useDatabase } from '../app/providers/DatabaseContext';
import { ClockProvider } from '../app/providers/ClockContext';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ClockProvider>
    <DatabaseProvider>{children}</DatabaseProvider>
  </ClockProvider>
);

describe('DatabaseContext Transaction Consistency & Audit', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    storageManager.resetDatabase();
  });

  it('preserves all consecutive mutations executed in rapid succession', () => {
    const { result } = renderHook(() => useDatabase(), { wrapper });

    const initialLength = result.current.db.courses.length;

    // Perform two consecutive updateDb operations in the same execution tick
    act(() => {
      result.current.updateDb((draft) => {
        draft.courses.push({
          id: 'course-batch-1',
          code: 'BATCH01',
          name: 'Batch Course 1',
          term: 'HK1-2026',
          description: 'Desc 1',
          teacherId: 'u-gv1',
          status: 'open',
        });
      });

      result.current.updateDb((draft) => {
        draft.courses.push({
          id: 'course-batch-2',
          code: 'BATCH02',
          name: 'Batch Course 2',
          term: 'HK1-2026',
          description: 'Desc 2',
          teacherId: 'u-gv1',
          status: 'open',
        });
      });
    });

    const currentDb = storageManager.getDatabase();
    expect(currentDb.courses.length).toBe(initialLength + 2);
    expect(currentDb.courses.some((c) => c.id === 'course-batch-1')).toBe(true);
    expect(currentDb.courses.some((c) => c.id === 'course-batch-2')).toBe(true);
  });

  it('returns failure and records failed audit when publishing non-existent submission', () => {
    const { result } = renderHook(() => useDatabase(), { wrapper });

    let publishResult: { ok: boolean; error?: { message: string } } = { ok: true };
    act(() => {
      publishResult = result.current.publishGrade('non-existent-sub-id', 9.5, undefined, 'Good job');
    });

    expect(publishResult.ok).toBe(false);
    expect(publishResult.error?.message).toContain('Không tìm thấy bài nộp');

    const currentDb = storageManager.getDatabase();
    const audit = currentDb.auditLogs.find(
      (a) => a.action === 'PUBLISH_GRADE' && a.entityId === 'non-existent-sub-id'
    );
    expect(audit).toBeDefined();
    expect(audit?.result).toBe('failed');
  });

  it('records successful audit and updates submission status when grade is published', () => {
    const { result } = renderHook(() => useDatabase(), { wrapper });

    // Pick a known submission from seed
    const targetSub = result.current.db.submissions[0];
    expect(targetSub).toBeDefined();

    let publishResult: { ok: boolean; error?: { message: string } } = { ok: false };
    act(() => {
      publishResult = result.current.publishGrade(targetSub.id, 8.5, undefined, 'Nhận xét kiểm thử');
    });

    expect(publishResult.ok).toBe(true);

    const currentDb = storageManager.getDatabase();
    const updatedSub = currentDb.submissions.find((s) => s.id === targetSub.id);
    expect(updatedSub?.gradingStatus).toBe('graded');

    const publishedRev = currentDb.gradeRevisions.find(
      (gr) => gr.submissionId === targetSub.id && gr.status === 'published' && gr.total === 8.5
    );
    expect(publishedRev).toBeDefined();

    const audit = currentDb.auditLogs.find(
      (a) => a.action === 'PUBLISH_GRADE' && a.entityId === targetSub.id
    );
    expect(audit).toBeDefined();
    expect(audit?.result).toBe('success');
  });
});
