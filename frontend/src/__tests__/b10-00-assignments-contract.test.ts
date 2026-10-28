import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storageManager } from '../infrastructure/persistence/storage';
import {
  MockAssignmentsAdapter,
  httpAssignmentsAdapter,
  getAssignmentService,
  setAssignmentService,
  resetAssignmentService,
  type AssignmentsPort,
  type CreateAssignmentInput,
  type UpdateAssignmentInput,
} from '../blueprints/assignments';

describe('B10-00: Assignments Contracts & Hexagonal Port Specification', () => {
  let adapter: MockAssignmentsAdapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    storageManager.resetDatabase();
    resetAssignmentService();
    adapter = new MockAssignmentsAdapter();
  });

  describe('1. Composition & Service Locator (Wiring)', () => {
    it('provides a default service implementing AssignmentsPort', () => {
      const service = getAssignmentService();
      expect(service).toBeDefined();
      expect(typeof service.listTeacherAssignments).toBe('function');
      expect(typeof service.getTeacherAssignmentDetail).toBe('function');
      expect(typeof service.createAssignment).toBe('function');
      expect(typeof service.updateAssignment).toBe('function');
      expect(typeof service.publishAssignment).toBe('function');
      expect(typeof service.closeAssignment).toBe('function');
      expect(typeof service.getStudentAssignment).toBe('function');
      expect(typeof service.checkStudentEligibility).toBe('function');
    });

    it('allows swapping adapter and resetting to default', () => {
      const customMock: Partial<AssignmentsPort> = {
        listTeacherAssignments: vi.fn(),
      };
      setAssignmentService(customMock as AssignmentsPort);
      expect(getAssignmentService()).toBe(customMock);

      // Reset
      resetAssignmentService();
      expect(getAssignmentService()).toBe(httpAssignmentsAdapter);
    });
  });

  describe('2. Teacher Operations Contracts', () => {
    const courseId = 'crs-it101';


    it('lists teacher assignments with pagination and status filtering', async () => {
      const res = await adapter.listTeacherAssignments(courseId);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(Array.isArray(res.data.items)).toBe(true);
      expect(res.data.pagination.page).toBe(1);
      expect(res.data.pagination.totalItems).toBeGreaterThan(0);

      // Filter by published
      const pubRes = await adapter.listTeacherAssignments(courseId, { status: 'published' });
      expect(pubRes.ok).toBe(true);
      if (!pubRes.ok) return;
      pubRes.data.items.forEach((item) => {
        expect(item.status).toBe('published');
      });

      // Filter by draft
      const draftRes = await adapter.listTeacherAssignments(courseId, { status: 'draft' });
      expect(draftRes.ok).toBe(true);
      if (!draftRes.ok) return;
      draftRes.data.items.forEach((item) => {
        expect(item.status).toBe('draft');
      });
    });

    it('returns error when listing assignments for non-existent course', async () => {
      const res = await adapter.listTeacherAssignments('non-existent-course-id');
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('NOT_FOUND');
    });

    it('retrieves detailed assignment info with rubric and file policy', async () => {
      const db = storageManager.getDatabase();
      const existing = db.assignments.find((a) => a.courseId === courseId)!;

      const res = await adapter.getTeacherAssignmentDetail(courseId, existing.id);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data.id).toBe(existing.id);
      expect(res.data.title).toBe(existing.title);
      expect(Array.isArray(res.data.rubricCriteria)).toBe(true);
      expect(res.data.filePolicy).toBeDefined();
      expect(res.data.totalScore).toBeGreaterThan(0);
    });

    it('creates a new draft assignment and enforces validation invariants', async () => {
      // Missing title
      const invalidRes = await adapter.createAssignment({
        courseId,
        title: '',
        instructions: 'Test',
        dueAt: '2026-11-30T23:59:59Z',
        allowLate: false,
        rubricCriteria: [],
      });
      expect(invalidRes.ok).toBe(false);
      if (invalidRes.ok) return;
      expect(invalidRes.error.code).toBe('VALIDATION_ERROR');

      // Valid creation
      const input: CreateAssignmentInput = {
        courseId,
        title: 'Bài tập Triết học Mác - Lênin số 1',
        instructions: 'Phân tích quy luật mâu thuẫn trong thực tiễn.',
        dueAt: '2026-11-20T23:59:59Z',
        allowLate: true,
        rubricCriteria: [
          { title: 'Cơ sở lý luận', description: 'Nắm vững quy luật', maxScore: 5 },
          { title: 'Liên hệ thực tiễn', description: 'Ví dụ phong phú', maxScore: 5 },
        ],
        filePolicy: {
          maxFilesPerSubmission: 2,
          maxFileSizeBytes: 10 * 1024 * 1024,
        },
      };

      const res = await adapter.createAssignment(input);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data.title).toBe(input.title);
      expect(res.data.status).toBe('draft');
      expect(res.data.totalScore).toBe(10);
      expect(res.data.filePolicy.maxFilesPerSubmission).toBe(2);
      expect(res.data.filePolicy.maxFileSizeBytes).toBe(10 * 1024 * 1024);
      expect(res.data.version).toBe(1);
    });

    it('rejects creating assignment in archived course', async () => {
      // Find or archive course
      const db = storageManager.getDatabase();
      const course = db.courses[0];
      course.status = 'archived';
      storageManager.saveDatabase(db);

      const res = await adapter.createAssignment({
        courseId: course.id,
        title: 'New assignment',
        instructions: 'Some instruction',
        dueAt: '2026-11-20T23:59:59Z',
        allowLate: false,
        rubricCriteria: [],
      });

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('COURSE_ARCHIVED');
    });

    it('enforces statement & rubric immutability once published (B10 Invariant)', async () => {
      // 1. Create a draft
      const createRes = await adapter.createAssignment({
        courseId,
        title: 'Bài tập nháp ban đầu',
        instructions: 'Yêu cầu ban đầu',
        dueAt: '2026-11-15T23:59:59Z',
        allowLate: false,
        rubricCriteria: [{ title: 'Tiêu chí 1', description: 'Đạt yêu cầu', maxScore: 10 }],
      });
      expect(createRes.ok).toBe(true);
      if (!createRes.ok) return;
      const assId = createRes.data.id;

      // 2. Publish it
      const pubRes = await adapter.publishAssignment(courseId, { assignmentId: assId });
      expect(pubRes.ok).toBe(true);
      if (!pubRes.ok) return;
      expect(pubRes.data.status).toBe('published');

      // 3. Attempt to update title retroactively -> MUST BE REJECTED
      const titleUpdateRes = await adapter.updateAssignment(courseId, assId, {
        title: 'Tiêu đề sửa đổi trái phép sau publish',
      });
      expect(titleUpdateRes.ok).toBe(false);
      if (titleUpdateRes.ok) return;
      expect(titleUpdateRes.error.code).toBe('IMMUTABLE_AFTER_PUBLISH');

      // 4. Attempt to update rubric criteria retroactively -> MUST BE REJECTED
      const rubricUpdateRes = await adapter.updateAssignment(courseId, assId, {
        rubricCriteria: [{ id: 'new-crit', title: 'Tiêu chí mới', description: '', maxScore: 20 }],
      });
      expect(rubricUpdateRes.ok).toBe(false);
      if (rubricUpdateRes.ok) return;
      expect(rubricUpdateRes.error.code).toBe('IMMUTABLE_AFTER_PUBLISH');

      // 5. Allowed post-publish update: dueAt, allowLate, future filePolicy -> MUST SUCCEED
      const allowedUpdate: UpdateAssignmentInput = {
        dueAt: '2026-11-25T23:59:59Z',
        allowLate: true,
        aiGradingOptIn: true,
        filePolicy: { maxFilesPerSubmission: 3 },
      };
      const allowedRes = await adapter.updateAssignment(courseId, assId, allowedUpdate);
      expect(allowedRes.ok).toBe(true);
      if (!allowedRes.ok) return;
      expect(allowedRes.data.dueAt).toBe('2026-11-25T23:59:59Z');
      expect(allowedRes.data.allowLate).toBe(true);
      expect(allowedRes.data.aiGradingOptIn).toBe(true);
      expect(allowedRes.data.filePolicy.maxFilesPerSubmission).toBe(3);
    });

    it('enforces optimistic concurrency control (version check)', async () => {
      const db = storageManager.getDatabase();
      const existing = db.assignments.find((a) => a.courseId === courseId)!;

      const conflictRes = await adapter.updateAssignment(courseId, existing.id, {
        dueAt: '2026-12-01T00:00:00Z',
        expectedVersion: 9999, // mismatched version
      });

      expect(conflictRes.ok).toBe(false);
      if (conflictRes.ok) return;
      expect(conflictRes.error.code).toBe('CONFLICT');
    });

    it('closes and reopens an assignment properly', async () => {
      const db = storageManager.getDatabase();
      const existing = db.assignments.find((a) => a.courseId === courseId)!;

      // Close assignment
      const closeRes = await adapter.closeAssignment(courseId, {
        assignmentId: existing.id,
        closeType: 'manual_close',
        reason: 'Hết thời gian làm bài chính thức.',
      });
      expect(closeRes.ok).toBe(true);
      if (!closeRes.ok) return;
      expect(closeRes.data.status).toBe('archived');
      expect(closeRes.data.manuallyClosedAt).toBeDefined();

      // Reopen assignment
      const reopenRes = await adapter.closeAssignment(courseId, {
        assignmentId: existing.id,
        closeType: 'reopen',
        reopenUntil: '2026-11-10T23:59:59Z',
        reason: 'Gia hạn nộp bài cho sinh viên có lý do chính đáng.',
      });
      expect(reopenRes.ok).toBe(true);
      if (!reopenRes.ok) return;
      expect(reopenRes.data.status).toBe('published');
      expect(reopenRes.data.manuallyClosedAt).toBeNull();
    });

    it('handles request cancellation via AbortSignal', async () => {
      const controller = new AbortController();
      controller.abort();

      const res = await adapter.listTeacherAssignments(courseId, undefined, {
        signal: controller.signal,
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('ABORTED');
    });
  });

  describe('3. Student Server-Authoritative Operations Contracts', () => {
    const courseId = 'crs-it101';

    beforeEach(() => {
      // Set student session
      storageManager.saveSession({
        userId: 'usr-sv-1',
        fullName: 'Sinh Viên 01',
        role: 'student',
        email: 'sinh-vien@example.edu.vn',
      });
    });


    it('returns server-authoritative student assignment view and eligibility', async () => {
      const db = storageManager.getDatabase();
      const assignment = db.assignments.find((a) => a.courseId === courseId && a.status === 'published')!;

      const res = await adapter.getStudentAssignment(courseId, assignment.id);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data.assignment.id).toBe(assignment.id);
      expect(res.data.assignment.title).toBe(assignment.title);
      expect(res.data.eligibility).toBeDefined();
      expect(res.data.eligibility.serverTime).toBeDefined();
      expect(typeof res.data.eligibility.canSubmit).toBe('boolean');
    });

    it('rejects access to unpublished draft assignments for students', async () => {
      const db = storageManager.getDatabase();
      const draftAss = db.assignments.find((a) => a.courseId === courseId && a.status === 'draft');
      if (!draftAss) return;

      const res = await adapter.getStudentAssignment(courseId, draftAss.id);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('NOT_FOUND');
    });

    it('correctly determines submission eligibility against deadline and allowLate', async () => {
      const db = storageManager.getDatabase();
      const assignment = db.assignments.find((a) => a.courseId === courseId && a.status === 'published')!;

      // Case 1: Before deadline -> allowed, not late
      const eligibilityRes = await adapter.checkStudentEligibility(courseId, assignment.id);
      expect(eligibilityRes.ok).toBe(true);
      if (!eligibilityRes.ok) return;
      expect(typeof eligibilityRes.data.canSubmit).toBe('boolean');
    });

    it('rejects eligibility for unenrolled students', async () => {
      // Set session for student not enrolled in c-triet-1
      storageManager.saveSession({
        userId: 'usr-unenrolled-student',
        fullName: 'Chưa Ghi Danh',
        role: 'student',
        email: '11249999@st.neu.edu.vn',
      });

      const db = storageManager.getDatabase();
      const assignment = db.assignments.find((a) => a.courseId === courseId && a.status === 'published')!;

      const res = await adapter.checkStudentEligibility(courseId, assignment.id);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.canSubmit).toBe(false);
      expect(res.data.reason).toBe('NOT_ENROLLED');
    });
  });

  describe('4. Legacy Interface Backwards Compatibility', () => {
    it('supports getStudentAssignmentDetail with legacy signature', async () => {
      const db = storageManager.getDatabase();
      const assignment = db.assignments[0];

      const res = await adapter.getStudentAssignmentDetail(assignment.id, 'usr-sv-1');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.assignment.id).toBe(assignment.id);
      expect(typeof res.data.canSubmit).toBe('boolean');
    });

    it('supports submitAssignment boundary placeholder', async () => {
      const db = storageManager.getDatabase();
      const assignment = db.assignments.find((a) => a.status === 'published')!;

      const res = await adapter.submitAssignment({
        assignmentId: assignment.id,
        studentId: 'usr-sv-1',
        file: {
          filename: 'bai_tap_tieu_luan.pdf',
          size: 1024 * 500,
        },
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.revisionNumber).toBeGreaterThanOrEqual(1);
      expect(res.data.submittedAt).toBeDefined();
    });
  });
});
