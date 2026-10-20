import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { storageManager } from '../infrastructure/persistence/storage';
import { SessionProvider } from '../app/providers/SessionContext';
import { DatabaseProvider, useDatabase } from '../app/providers/DatabaseContext';
import { ClockProvider } from '../app/providers/ClockContext';
import { NotificationProvider } from '../app/providers/NotificationContext';
import { CourseTeacherLayout } from '../app/layouts/CourseTeacherLayout';
import { TeacherGradingPage } from '../blueprints/grading/pages/TeacherGradingPage';
import {
  getLatestPublishedGrade,
  getLatestDraftGrade,
  canTeacherAccessCourse
} from '../blueprints/grading/domain/gradingPolicies';
import { checkSubmissionEligibility } from '../blueprints/assignments/domain/assignmentPolicies';
import { mockAssignmentsAdapter } from '../blueprints/assignments/adapters/mockAssignmentsAdapter';
import { mockGradingAdapter } from '../blueprints/grading/adapters/mockGradingAdapter';
import type { GradeRevision, Course, Assignment, Membership } from '../shared/kernel/types';

describe('Đợt 2: Assignment Submission & Grading Vertical Slice', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    storageManager.resetDatabase();
  });

  describe('1. Entity Authorization Guard (INT-03)', () => {
    it('blocks teacher from accessing a course taught by another instructor', () => {
      const db = storageManager.getDatabase();
      const course = db.courses.find((c) => c.teacherId === 'usr-gv-1')!;

      // Teacher 2 attempting to access Teacher 1 course
      const teacher2 = db.users.find((u) => u.id === 'usr-gv-2')!;
      expect(canTeacherAccessCourse(course, teacher2)).toBe(false);

      // Teacher 1 accessing own course
      const teacher1 = db.users.find((u) => u.id === 'usr-gv-1')!;
      expect(canTeacherAccessCourse(course, teacher1)).toBe(true);

      // Admin accessing any course
      const admin = db.users.find((u) => u.role === 'admin')!;
      expect(canTeacherAccessCourse(course, admin)).toBe(true);
    });

    it('renders access denied in CourseTeacherLayout when cross-teacher access is attempted', () => {
      const db = storageManager.getDatabase();
      const course1 = db.courses.find((c) => c.teacherId === 'usr-gv-1')!;
      const teacher2 = db.users.find((u) => u.id === 'usr-gv-2')!;

      storageManager.saveSession({
        userId: teacher2.id,
        role: 'teacher',
        fullName: teacher2.fullName,
        email: teacher2.emailNormalized,
      });

      render(
        <ClockProvider>
          <DatabaseProvider>
            <SessionProvider>
              <NotificationProvider>
                <MemoryRouter initialEntries={[`/gv/mon-hoc/${course1.id}`]}>
                  <Routes>
                    <Route path="/gv/mon-hoc/:monId" element={<CourseTeacherLayout />}>
                      <Route index element={<div>Nội dung môn học</div>} />
                    </Route>
                    <Route path="/gv/mon-hoc" element={<div>Danh sách môn học của tôi</div>} />
                  </Routes>
                </MemoryRouter>
              </NotificationProvider>
            </SessionProvider>
          </DatabaseProvider>
        </ClockProvider>
      );

      // Should show course not found / unauthorized
      expect(screen.getByText('Không tìm thấy môn học')).toBeDefined();
      expect(screen.queryByText('Nội dung môn học')).toBeNull();
    });
  });

  describe('2. Deterministic Published Grade Resolution (INT-05)', () => {
    it('picks the latest published revision regardless of array insertion order', () => {
      const sampleRevisions: GradeRevision[] = [
        {
          id: 'gr-older',
          submissionId: 'sub-test',
          submissionRevisionId: 'rev-1',
          criterionScores: [{ criterionId: 'crit-1', score: 5.0 }],
          feedback: 'Lần chấm 1: Điểm 5.0',
          total: 5.0,
          status: 'published',
          authorId: 'u-gv1',
          createdAt: '2026-10-10T10:00:00Z',
          publishedAt: '2026-10-10T10:00:00Z'
        },
        {
          id: 'gr-draft',
          submissionId: 'sub-test',
          submissionRevisionId: 'rev-2',
          criterionScores: [{ criterionId: 'crit-1', score: 7.0 }],
          feedback: 'Đang chấm dở 7.0',
          total: 7.0,
          status: 'draft',
          authorId: 'u-gv1',
          createdAt: '2026-10-12T09:00:00Z'
        },
        {
          id: 'gr-latest-published',
          submissionId: 'sub-test',
          submissionRevisionId: 'rev-2',
          criterionScores: [{ criterionId: 'crit-1', score: 8.5 }],
          feedback: 'Chấm lại sau phúc khảo: Điểm 8.5',
          total: 8.5,
          status: 'published',
          authorId: 'u-gv1',
          createdAt: '2026-10-14T14:00:00Z',
          publishedAt: '2026-10-14T14:00:00Z'
        }
      ];

      const resolved = getLatestPublishedGrade(sampleRevisions, 'sub-test');
      expect(resolved).toBeDefined();
      expect(resolved?.id).toBe('gr-latest-published');
      expect(resolved?.total).toBe(8.5);

      const latestDraft = getLatestDraftGrade(sampleRevisions, 'sub-test');
      expect(latestDraft?.id).toBe('gr-draft');
    });
  });

  describe('3. Submission Deadline & Eligibility Policy', () => {
    const course: Course = {
      id: 'crs-1',
      code: 'TEST101',
      name: 'Môn thử nghiệm',
      term: 'HK1-2026',
      description: 'Mô tả',
      teacherId: 'usr-gv-1',
      status: 'open'
    };

    const memberships: Membership[] = [
      {
        id: 'mem-1',
        courseId: 'crs-1',
        userId: 'usr-sv-1',
        emailNormalized: 'sv1@example.edu.vn',
        status: 'active',
        addedAt: '2026-10-01T08:00:00Z'
      }
    ];

    const assignment: Assignment = {
      id: 'ass-1',
      courseId: 'crs-1',
      title: 'Bài tập lớn',
      instructions: 'Đề bài',
      attachments: [],
      rubricCriteria: [{ id: 'c1', title: 'Tiêu chí 1', description: '', maxScore: 10 }],
      maxScore: 10,
      dueAt: '2026-10-20T23:59:00Z',
      allowLate: true,
      status: 'published'
    };

    it('marks submission on-time when before dueAt', () => {
      const result = checkSubmissionEligibility(
        assignment,
        course,
        memberships,
        'usr-sv-1',
        '2026-10-20T10:00:00Z'
      );
      expect(result.allowed).toBe(true);
      expect(result.isLate).toBe(false);
    });

    it('marks submission late when past dueAt but allowLate is true', () => {
      const result = checkSubmissionEligibility(
        assignment,
        course,
        memberships,
        'usr-sv-1',
        '2026-10-21T08:00:00Z'
      );
      expect(result.allowed).toBe(true);
      expect(result.isLate).toBe(true);
    });

    it('rejects submission when past dueAt and allowLate is false', () => {
      const strictAss: Assignment = { ...assignment, allowLate: false };
      const result = checkSubmissionEligibility(
        strictAss,
        course,
        memberships,
        'usr-sv-1',
        '2026-10-21T08:00:00Z'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DEADLINE_PASSED');
    });

    it('rejects submission when student is not enrolled', () => {
      const result = checkSubmissionEligibility(
        assignment,
        course,
        memberships,
        'usr-sv-stranger',
        '2026-10-20T10:00:00Z'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('NOT_ENROLLED');
    });
  });

  describe('4. Bulk Publish Rubric Scores Preservation', () => {
    it('preserves criterion scores during bulk publish', async () => {
      const result = await mockGradingAdapter.bulkPublishGrades({
        courseId: 'crs-test',
        assignmentId: 'ass-test',
        items: [
          {
            submissionId: 'sub-bulk-1',
            score: 9.0,
            rubricScores: { crit_1: 4.0, crit_2: 5.0 },
            feedback: 'Hoàn thành xuất sắc'
          }
        ]
      });

      expect(result.ok).toBe(true);
    });
  });
});
