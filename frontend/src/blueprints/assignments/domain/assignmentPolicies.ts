import type { Assignment, Course, Membership } from '../../../shared/kernel/types';

export interface SubmissionEligibilityResult {
  allowed: boolean;
  isLate: boolean;
  reason?: 'COURSE_ARCHIVED' | 'NOT_ENROLLED' | 'ASSIGNMENT_NOT_PUBLISHED' | 'DEADLINE_PASSED';
  message?: string;
}

/**
 * Validates whether a student is eligible to submit an assignment according to baseline business rules.
 */
export function checkSubmissionEligibility(
  assignment: Assignment | null | undefined,
  course: Course | null | undefined,
  memberships: Membership[],
  userId: string | null | undefined,
  nowIso: string
): SubmissionEligibilityResult {
  if (!assignment || assignment.status !== 'published') {
    return {
      allowed: false,
      isLate: false,
      reason: 'ASSIGNMENT_NOT_PUBLISHED',
      message: 'Bài tập không tồn tại hoặc chưa được công bố.'
    };
  }

  if (!course || course.status === 'archived') {
    return {
      allowed: false,
      isLate: false,
      reason: 'COURSE_ARCHIVED',
      message: 'Môn học đã lưu trữ, không nhận thêm bài nộp.'
    };
  }

  if (!userId) {
    return {
      allowed: false,
      isLate: false,
      reason: 'NOT_ENROLLED',
      message: 'Người dùng chưa đăng nhập.'
    };
  }

  const isEnrolled = memberships.some(
    m => m.courseId === course.id && m.userId === userId && m.status === 'active'
  );

  if (!isEnrolled) {
    return {
      allowed: false,
      isLate: false,
      reason: 'NOT_ENROLLED',
      message: 'Sinh viên chưa ghi danh hợp lệ vào môn học này.'
    };
  }

  const nowDate = new Date(nowIso).getTime();
  const dueDate = new Date(assignment.dueAt).getTime();

  if (assignment.manuallyClosedAt && nowDate > new Date(assignment.manuallyClosedAt).getTime()) {
    return {
      allowed: false,
      isLate: true,
      reason: 'DEADLINE_PASSED',
      message: 'Bài tập đã đóng nhận bài nộp thủ công.'
    };
  }

  if (nowDate <= dueDate) {
    return {
      allowed: true,
      isLate: false
    };
  }

  if (assignment.allowLate) {
    return {
      allowed: true,
      isLate: true
    };
  }

  return {
    allowed: false,
    isLate: true,
    reason: 'DEADLINE_PASSED',
    message: 'Đã quá hạn nộp bài tập và bài tập không cho phép nộp muộn.'
  };
}
