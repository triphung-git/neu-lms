import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DatabaseProvider, useDatabase } from '../app/providers/DatabaseContext';
import { storageManager } from '../infrastructure/persistence/storage';
import { parseCSV } from '../shared/lib/csv';
import { demoClock } from '../shared/kernel/clock';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DatabaseProvider>{children}</DatabaseProvider>
);

describe('Đợt 3: Comprehensive Expansion Regression Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    storageManager.resetDatabase();
  });

  describe('1. Membership Domain & Safe Mapping', () => {
    it('correctly maps active status for registered user and pending for unregistered email', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.addMembers('c-cs101', [
          { email: 'sinh-vien@example.edu.vn', name: 'Nguyễn Thị Hương' },
          { email: 'new-unregistered@neu.edu.vn', name: 'Chưa có tài khoản' },
        ]);
      });

      const db = storageManager.getDatabase();
      const sv1Mem = db.memberships.find(
        (m) => m.emailNormalized === 'sinh-vien@example.edu.vn' && m.courseId === 'c-cs101'
      );
      const unregMem = db.memberships.find(
        (m) => m.emailNormalized === 'new-unregistered@neu.edu.vn' && m.courseId === 'c-cs101'
      );

      expect(sv1Mem).toBeDefined();
      expect(sv1Mem?.status).toBe('active');
      expect(sv1Mem?.userId).toBe('usr-sv-1');
      expect(sv1Mem?.addedAt).toBeDefined();

      expect(unregMem).toBeDefined();
      expect(unregMem?.status).toBe('pending');
      expect(unregMem?.userId).toBeUndefined();
    });

    it('withdraws and restores membership using demoClock timestamps', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.addMembers('c-cs101', [
          { email: 'sv2@neu.edu.vn', name: 'Sinh viên 2' },
        ]);
      });

      const initialMem = storageManager
        .getDatabase()
        .memberships.find((m) => m.emailNormalized === 'sv2@neu.edu.vn');
      expect(initialMem).toBeDefined();

      act(() => {
        result.current.withdrawMembership(initialMem!.id);
      });

      let updated = storageManager
        .getDatabase()
        .memberships.find((m) => m.id === initialMem!.id);
      expect(updated?.status).toBe('withdrawn');
      expect(updated?.withdrawnAt).toBe(demoClock.now());

      act(() => {
        result.current.restoreMembership(initialMem!.id);
      });

      updated = storageManager
        .getDatabase()
        .memberships.find((m) => m.id === initialMem!.id);
      expect(updated?.status).toBe('active');
      expect(updated?.withdrawnAt).toBeUndefined();
    });
  });

  describe('2. Material Version Linking & Atomic Creation', () => {
    it('creates material and version atomically with shared IDs and class visibility', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.createMaterial({
          id: 'mat-test-1',
          courseId: 'c-cs101',
          lessonId: 'les-1',
          title: 'Bài giảng Mạng máy tính',
          visibility: 'class',
        });
      });

      const db = storageManager.getDatabase();
      const mat = db.materials.find((m) => m.id === 'mat-test-1');
      expect(mat).toBeDefined();
      expect(mat?.currentVersionId).toBeDefined();
      expect(mat?.publishedVersionIds).toContain(mat?.currentVersionId);

      const ver = db.materialVersions.find((v) => v.id === mat?.currentVersionId);
      expect(ver).toBeDefined();
      expect(ver?.materialId).toBe('mat-test-1');
      expect(ver?.versionNumber).toBe(1);
    });

    it('adds new material version and updates material currentVersionId', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.createMaterial({
          id: 'mat-test-2',
          courseId: 'c-cs101',
          lessonId: 'les-1',
          title: 'Giáo trình C++',
          visibility: 'draft',
        });
      });

      act(() => {
        result.current.addMaterialVersion({
          materialId: 'mat-test-2',
          filename: 'cpp-v2.pdf',
          sampleContent: 'Nội dung cập nhật chương 2',
        });
      });

      const db = storageManager.getDatabase();
      const mat = db.materials.find((m) => m.id === 'mat-test-2');
      const versions = db.materialVersions.filter((v) => v.materialId === 'mat-test-2');

      expect(versions.length).toBe(2);
      expect(versions[1].versionNumber).toBe(2);
      expect(mat?.currentVersionId).toBe(versions[1].id);
    });
  });

  describe('3. AI Drafts & Material Summary Commit', () => {
    it('commits confirmed AI summary directly into source MaterialVersion summary', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.createMaterial({
          id: 'mat-ai-target',
          courseId: 'c-cs101',
          lessonId: 'les-1',
          title: 'Tài liệu kiến trúc máy tính',
          visibility: 'class',
        });
      });

      const mat = storageManager
        .getDatabase()
        .materials.find((m) => m.id === 'mat-ai-target');
      const versionId = mat!.currentVersionId;

      act(() => {
        result.current.createAIDraft({
          type: 'summary',
          materialId: 'mat-ai-target',
          courseId: 'c-cs101',
          content: 'Bản nháp tóm tắt ban đầu',
        });
      });

      const dbAfterDraft = storageManager.getDatabase();
      const draft = dbAfterDraft.aiDrafts[dbAfterDraft.aiDrafts.length - 1];

      // Update draft and confirm with linked source version
      act(() => {
        result.current.updateAIDraft(draft.id, {
          sourceVersionIds: [versionId],
          text: 'Tóm tắt chuẩn hóa đã được giảng viên phê duyệt.',
          status: 'confirmed',
        });
      });

      const dbFinal = storageManager.getDatabase();
      const updatedVersion = dbFinal.materialVersions.find((v) => v.id === versionId);
      expect(updatedVersion?.summary).toBe(
        'Tóm tắt chuẩn hóa đã được giảng viên phê duyệt.'
      );
    });
  });

  describe('4. Announcements & Email Jobs', () => {
    it('creates email job only when sendEmail is true and emailEnabled is true', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.createAnnouncement({
          courseId: 'c-cs101',
          title: 'Thông báo không gửi email',
          body: 'Nội dung thông báo bảng tin',
          sendEmail: false,
        });
      });

      let db = storageManager.getDatabase();
      let job = db.emailJobs.find((j) => j.type === 'announcement' && j.entityId === db.announcements[0]?.id);
      expect(job).toBeUndefined();

      act(() => {
        result.current.createAnnouncement({
          courseId: 'c-cs101',
          title: 'Thông báo có gửi email',
          body: 'Gửi email cho sinh viên',
          sendEmail: true,
        });
      });

      db = storageManager.getDatabase();
      job = db.emailJobs.find((j) => j.type === 'announcement' && j.entityId === db.announcements[0]?.id);
      expect(job).toBeDefined();
      expect(job?.status).toBe('queued');
      expect(job?.attempts).toBe(1);
    });

    it('retries failed email job, increments attempts and updates status to success', () => {
      const { result } = renderHook(() => useDatabase(), { wrapper });

      act(() => {
        result.current.updateDb((draft) => {
          draft.emailJobs.push({
            id: 'job-failed-1',
            type: 'announcement',
            entityId: 'ann-1',
            status: 'partial_error',
            recipients: ['sv1@neu.edu.vn'],
            failedRecipients: ['sv2@neu.edu.vn'],
            attempts: 1,
          });
        });
      });

      act(() => {
        result.current.retryFailedEmailJobs('job-failed-1');
      });

      const job = storageManager
        .getDatabase()
        .emailJobs.find((j) => j.id === 'job-failed-1');
      expect(job?.status).toBe('success');
      expect(job?.failedRecipients).toEqual([]);
      expect(job?.attempts).toBe(2);
    });
  });

  describe('5. Admin Self-Guard Protection', () => {
    it('prevents current user from locking their own account', () => {
      storageManager.saveSession({
        userId: 'usr-admin-1',
        email: 'quan-tri@example.edu.vn',
        fullName: 'Quản trị viên Hệ thống',
        role: 'admin',
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      let lockRes: { ok: boolean; error?: { message: string } } = { ok: true };
      act(() => {
        lockRes = result.current.lockAccount('usr-admin-1');
      });

      expect(lockRes.ok).toBe(false);
      expect(lockRes.error?.message).toContain('Không thể tự khóa tài khoản');

      const adminUser = storageManager
        .getDatabase()
        .users.find((u) => u.id === 'usr-admin-1');
      expect(adminUser?.status).toBe('active');
    });

    it('prevents current user from changing their own role', () => {
      storageManager.saveSession({
        userId: 'usr-admin-1',
        email: 'quan-tri@example.edu.vn',
        fullName: 'Quản trị viên Hệ thống',
        role: 'admin',
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      let roleRes: { ok: boolean; error?: { message: string } } = { ok: true };
      act(() => {
        roleRes = result.current.changeUserRole('usr-admin-1', 'student');
      });

      expect(roleRes.ok).toBe(false);
      expect(roleRes.error?.message).toContain('Không thể tự thay đổi vai trò');

      const adminUser = storageManager
        .getDatabase()
        .users.find((u) => u.id === 'usr-admin-1');
      expect(adminUser?.role).toBe('admin');
    });
  });

  describe('6. CSV Accented Vietnamese Parsing', () => {
    it('correctly parses headers with accents and maps roles "Giảng viên" and "Sinh viên"', () => {
      const csvContent = `Họ và tên,Email,Vai trò\nTrần Thị Bích,bich.tt@neu.edu.vn,Giảng viên\nLê Hoàng Nam,nam.lh@neu.edu.vn,Sinh viên`;

      const result = parseCSV(csvContent);

      expect(result.totalRows).toBe(2);
      expect(result.validRows.length).toBe(2);
      expect(result.invalidRows.length).toBe(0);

      expect(result.validRows[0].fullName).toBe('Trần Thị Bích');
      expect(result.validRows[0].emailNormalized).toBe('bich.tt@neu.edu.vn');
      expect(result.validRows[0].assignedRole).toBe('teacher');

      expect(result.validRows[1].fullName).toBe('Lê Hoàng Nam');
      expect(result.validRows[1].emailNormalized).toBe('nam.lh@neu.edu.vn');
      expect(result.validRows[1].assignedRole).toBe('student');
    });
  });
});
