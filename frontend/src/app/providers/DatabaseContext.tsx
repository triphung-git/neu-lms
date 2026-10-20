import React, { createContext, useContext, useState, useEffect } from 'react';
import { storageManager } from '../../infrastructure/persistence/storage';
import type { DatabaseState } from '../../infrastructure/mock/mockDatabase';
import type {
  User,
  UserRole,
  ValidEmail,
  Course,
  Membership,
  Chapter,
  Lesson,
  Material,
  MaterialVersion,
  Assignment,
  Submission,
  GradeRevision,
  Announcement,
  EmailJob,
  AIDraft,
  AuditEvent,
  SystemSettings
} from '../../shared/kernel/types';
import { demoClock } from '../../shared/kernel/clock';

export interface DatabaseContextType {
  db: DatabaseState;
  updateDb: (updater: (draft: DatabaseState) => void, auditAction?: { action: string; entityType: string; entityId: string; result?: 'success' | 'failed' }) => void;
  resetDb: () => void;
  isMemoryOnly: boolean;

  // Direct collection accessors
  users: User[];
  validEmails: ValidEmail[];
  courses: Course[];
  memberships: Membership[];
  chapters: Chapter[];
  lessons: Lesson[];
  materials: Material[];
  materialVersions: MaterialVersion[];
  assignments: Assignment[];
  submissions: Submission[];
  gradeRevisions: GradeRevision[];
  announcements: Announcement[];
  emailJobs: EmailJob[];
  aiDrafts: AIDraft[];
  auditLogs: AuditEvent[];
  auditEvents: AuditEvent[];
  settings: SystemSettings;
  systemSettings: SystemSettings;

  // Common helpers
  addMembers: (courseId: string, members: any[]) => { ok: boolean; error?: { message: string } };
  withdrawMembership: (membershipId: string) => void;
  restoreMembership: (membershipId: string) => void;
  publishGrade: (submissionId: string, score: number, rubricScores?: Record<string, number>, feedback?: string) => { ok: boolean; error?: { message: string } };
  saveGradeDraft: (submissionId: string, score: number, rubricScores?: Record<string, number>, feedback?: string) => { ok: boolean; error?: { message: string } };
  archiveCourse: (courseId: string) => { ok: boolean; error?: { message: string } };
  transferCourseTeacher: (courseId: string, newTeacherId: string, teacherName?: string) => { ok: boolean; error?: { message: string } };
  createCourse: (c: any) => { ok: boolean; error?: { message: string } };
  createChapter: (courseIdOrObj: any, title?: string, description?: string) => { ok: boolean; error?: { message: string } };
  updateChapter: (chapterId: string, updates: any) => { ok: boolean; error?: { message: string } };
  deleteChapter: (chapterId: string) => { ok: boolean; error?: { message: string } };
  createLesson: (chapterIdOrObj: any, title?: string, description?: string) => { ok: boolean; error?: { message: string } };
  updateLesson: (lessonId: string, updates: any) => { ok: boolean; error?: { message: string } };
  deleteLesson: (lessonId: string) => { ok: boolean; error?: { message: string } };
  createMaterial: (mat: any) => void;
  addMaterialVersion: (ver: any) => void;
  updateMaterial: (id: string, updates: Partial<Material>) => { ok: boolean; error?: { message: string } };
  createAIDraft: (draft: any) => void;
  updateAIDraft: (id: string, updates: any) => { ok: boolean; error?: { message: string } };

  // Account & system helpers
  lockAccount: (userId: string) => { ok: boolean; error?: { message: string } };
  unlockAccount: (userId: string) => { ok: boolean; error?: { message: string } };
  changeUserRole: (userId: string, newRole: UserRole) => { ok: boolean; error?: { message: string } };
  addEligibleEmails: (emails: any[]) => { ok: boolean; error?: { message: string } };
  deleteEligibleEmail: (email: string) => { ok: boolean; error?: { message: string } };
  updateSystemSettings: (updates: Partial<SystemSettings>) => { ok: boolean; error?: { message: string } };

  // Announcements & emails
  markAnnouncementAsRead: (id: string) => void;
  markAllAnnouncementsAsRead: () => void;
  createAnnouncement: (announcement: any) => { ok: boolean; error?: { message: string } };
  retryFailedEmailJobs: (jobId?: string) => { ok: boolean; error?: { message: string } };

  // Assignments & submissions
  submitAssignment: (assignmentId: string, studentId: string, file: any) => { ok: boolean; error?: { message: string } };
  createAssignment: (ass: any) => { ok: boolean; error?: { message: string } };
  updateAssignment: (id: string, updates: any) => { ok: boolean; error?: { message: string } };
}

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<DatabaseState>(() => storageManager.getDatabase());
  const [isMemoryOnly, setIsMemoryOnly] = useState<boolean>(() => storageManager.isMemoryOnly());

  useEffect(() => {
    return storageManager.subscribe((newDb) => {
      setDb({ ...newDb });
      setIsMemoryOnly(storageManager.isMemoryOnly());
    });
  }, []);

  const updateDb = (
    updater: (draft: DatabaseState) => void,
    auditAction?: { action: string; entityType: string; entityId: string; result?: 'success' | 'failed' }
  ) => {
    const current = storageManager.getDatabase();
    const clone: DatabaseState = JSON.parse(JSON.stringify(current));
    updater(clone);

    if (auditAction) {
      const session = storageManager.getSession();
      const newAudit: AuditEvent = {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: demoClock.now(),
        actorId: session?.userId || 'system',
        actorName: session?.fullName || 'Hệ thống',
        actorRole: (session?.role || 'admin') as any,
        action: auditAction.action,
        entityType: auditAction.entityType,
        entityId: auditAction.entityId,
        result: auditAction.result || 'success',
        redactedDetails: `Thực hiện ${auditAction.action} trên ${auditAction.entityType} ${auditAction.entityId}`,
      };
      clone.auditLogs.unshift(newAudit);
    }

    storageManager.saveDatabase(clone);
  };

  const resetDb = () => {
    storageManager.resetDatabase();
  };

  const addMembers = (courseId: string, newMembers: any[]) => {
    updateDb((draft) => {
      newMembers.forEach((m) => {
        const rawEmail = (m.emailNormalized || m.userEmail || m.email || '').trim().toLowerCase();
        const matchedUser = draft.users.find(
          (u) => u.emailNormalized.toLowerCase() === rawEmail || (m.userId && u.id === m.userId)
        );
        const resolvedUserId = matchedUser?.id || (m.userId && !m.userId.startsWith('user-temp-') ? m.userId : undefined);
        const resolvedStatus = m.status || (matchedUser ? 'active' : 'pending');

        draft.memberships.push({
          id: m.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          courseId,
          emailNormalized: rawEmail,
          userId: resolvedUserId,
          status: resolvedStatus,
          addedAt: demoClock.now(),
          ...(m.userName || matchedUser?.fullName ? { userName: m.userName || matchedUser?.fullName } : {}),
          ...(m.userEmail ? { userEmail: m.userEmail } : {}),
        } as any);
      });
    }, { action: 'ADD_MEMBERS', entityType: 'Course', entityId: courseId });
    return { ok: true };
  };

  const withdrawMembership = (membershipId: string) => {
    updateDb((draft) => {
      const mem = draft.memberships.find((m) => m.id === membershipId);
      if (mem) {
        mem.status = 'withdrawn';
        mem.withdrawnAt = demoClock.now();
      }
    }, { action: 'WITHDRAW_MEMBERSHIP', entityType: 'Membership', entityId: membershipId });
  };

  const restoreMembership = (membershipId: string) => {
    updateDb((draft) => {
      const mem = draft.memberships.find((m) => m.id === membershipId);
      if (mem) {
        mem.status = 'active';
        delete mem.withdrawnAt;
      }
    }, { action: 'RESTORE_MEMBERSHIP', entityType: 'Membership', entityId: membershipId });
  };

  const publishGrade = (
    submissionId: string,
    score: number,
    rubricScores?: Record<string, number>,
    feedback?: string
  ): { ok: boolean; error?: { message: string } } => {
    const current = storageManager.getDatabase();
    const target = current.submissions.find((s) => s.id === submissionId);
    if (!target) {
      updateDb(() => {}, {
        action: 'PUBLISH_GRADE',
        entityType: 'Submission',
        entityId: submissionId,
        result: 'failed'
      });
      return { ok: false, error: { message: 'Không tìm thấy bài nộp' } };
    }

    updateDb((draft) => {
      const sub = draft.submissions.find((s) => s.id === submissionId);
      if (sub) {
        sub.gradingStatus = 'graded';
        const latestRev = sub.revisions[sub.revisions.length - 1];
        const gradeRev: GradeRevision = {
          id: `gr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          submissionId,
          submissionRevisionId: latestRev ? latestRev.id : 'rev-1',
          criterionScores: rubricScores ? Object.entries(rubricScores).map(([criterionId, sVal]) => ({ criterionId, score: sVal })) : [],
          feedback: feedback || '',
          total: score,
          status: 'published',
          authorId: 'u-gv1',
          createdAt: demoClock.now(),
          publishedAt: demoClock.now()
        };
        draft.gradeRevisions.push(gradeRev);
      }
    }, { action: 'PUBLISH_GRADE', entityType: 'Submission', entityId: submissionId, result: 'success' });
    return { ok: true };
  };

  const saveGradeDraft = (
    submissionId: string,
    score: number,
    rubricScores?: Record<string, number>,
    feedback?: string
  ): { ok: boolean; error?: { message: string } } => {
    const current = storageManager.getDatabase();
    const target = current.submissions.find((s) => s.id === submissionId);
    if (!target) {
      updateDb(() => {}, {
        action: 'SAVE_GRADE_DRAFT',
        entityType: 'Submission',
        entityId: submissionId,
        result: 'failed'
      });
      return { ok: false, error: { message: 'Không tìm thấy bài nộp' } };
    }

    updateDb((draft) => {
      const sub = draft.submissions.find((s) => s.id === submissionId);
      if (sub) {
        sub.gradingStatus = 'in_progress';
        const latestRev = sub.revisions[sub.revisions.length - 1];
        const gradeRev: GradeRevision = {
          id: `gr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          submissionId,
          submissionRevisionId: latestRev ? latestRev.id : 'rev-1',
          criterionScores: rubricScores ? Object.entries(rubricScores).map(([criterionId, sVal]) => ({ criterionId, score: sVal })) : [],
          feedback: feedback || '',
          total: score,
          status: 'draft',
          authorId: 'u-gv1',
          createdAt: demoClock.now()
        };
        draft.gradeRevisions.push(gradeRev);
      }
    }, { action: 'SAVE_GRADE_DRAFT', entityType: 'Submission', entityId: submissionId, result: 'success' });
    return { ok: true };
  };

  const createMaterial = (mat: any) => {
    updateDb((draft) => {
      const materialId = mat.id || `mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const versionId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const isClassVisible = mat.visibility === 'class';
      draft.materials.push({
        id: materialId,
        courseId: mat.courseId,
        lessonId: mat.lessonId,
        title: mat.title,
        tags: mat.tags || [],
        visibility: mat.visibility || 'draft',
        currentVersionId: versionId,
        publishedVersionIds: isClassVisible ? [versionId] : [],
      });
      draft.materialVersions.push({
        id: versionId,
        materialId,
        versionNumber: 1,
        filename: mat.filename || `${mat.title}.pdf`,
        mime: mat.mime || 'application/pdf',
        sizeBytes: mat.sizeBytes || 1024 * 1024,
        uploadedBy: mat.uploadedBy || 'teacher',
        uploadedAt: demoClock.now(),
        scanStatus: 'clean',
        extractionStatus: 'success',
        indexStatus: 'success',
        summary: mat.summary || 'Tài liệu học tập số hóa',
      });
    }, { action: 'CREATE_MATERIAL', entityType: 'Material', entityId: mat.id || 'new-material' });
  };

  const addMaterialVersion = (ver: any) => {
    updateDb((draft) => {
      const versionId = ver.id || `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const existingVersions = draft.materialVersions.filter((v) => v.materialId === ver.materialId);
      const versionNumber = ver.versionNumber || (existingVersions.length + 1);

      draft.materialVersions.push({
        id: versionId,
        materialId: ver.materialId,
        versionNumber,
        filename: ver.filename || 'updated-doc.pdf',
        mime: ver.mime || 'application/pdf',
        sizeBytes: ver.sizeBytes || ver.fileSize || 1024 * 1024,
        uploadedBy: ver.uploadedBy || 'teacher',
        uploadedAt: demoClock.now(),
        scanStatus: 'clean',
        extractionStatus: 'success',
        indexStatus: 'success',
        summary: ver.sampleContent || ver.summary || 'Phiên bản cập nhật',
      });
      const m = draft.materials.find((item) => item.id === ver.materialId);
      if (m) {
        m.currentVersionId = versionId;
      }
    }, { action: 'ADD_MATERIAL_VERSION', entityType: 'MaterialVersion', entityId: ver.materialId });
  };

  const updateMaterial = (id: string, updates: Partial<Material>) => {
    updateDb((draft) => {
      const idx = draft.materials.findIndex((m) => m.id === id);
      if (idx !== -1) {
        draft.materials[idx] = { ...draft.materials[idx], ...updates };
      }
    }, { action: 'UPDATE_MATERIAL', entityType: 'Material', entityId: id });
    return { ok: true };
  };

  const createAIDraft = (draftItem: any) => {
    updateDb((draft) => {
      draft.aiDrafts.push({
        id: `draft-${Date.now()}`,
        type: draftItem.type || 'summary',
        materialId: draftItem.materialId,
        courseId: draftItem.courseId || '',
        status: 'draft',
        content: draftItem.content || draftItem.summary || '',
        createdAt: demoClock.now(),
      } as any);
    }, { action: 'CREATE_AI_DRAFT', entityType: 'AIDraft', entityId: draftItem.materialId || 'ai-draft' });
  };

  const archiveCourse = (courseId: string) => {
    updateDb((draft) => {
      const c = draft.courses.find(x => x.id === courseId);
      if (c) {
        c.status = 'archived';
        c.archivedAt = demoClock.now();
      }
    }, { action: 'ARCHIVE_COURSE', entityType: 'Course', entityId: courseId });
    return { ok: true };
  };

  const transferCourseTeacher = (courseId: string, newTeacherId: string, _teacherName?: string) => {
    updateDb((draft) => {
      const c = draft.courses.find(x => x.id === courseId);
      if (c) {
        c.teacherId = newTeacherId;
      }
    }, { action: 'TRANSFER_TEACHER', entityType: 'Course', entityId: courseId });
    return { ok: true };
  };

  const createCourse = (c: any) => {
    updateDb((draft) => {
      draft.courses.push({
        id: c.id || `c-${Date.now()}`,
        code: c.code.toUpperCase(),
        name: c.name,
        term: c.term || 'HK1-2026',
        description: c.description || '',
        teacherId: c.teacherId || 'u-gv1',
        status: 'open',
      });
    }, { action: 'CREATE_COURSE', entityType: 'Course', entityId: c.code });
    return { ok: true };
  };

  const createChapter = (courseIdOrObj: any, title?: string, description?: string) => {
    updateDb((draft) => {
      const courseId = typeof courseIdOrObj === 'object' ? courseIdOrObj.courseId : courseIdOrObj;
      const chTitle = typeof courseIdOrObj === 'object' ? courseIdOrObj.title : (title || '');
      const chDesc = typeof courseIdOrObj === 'object' ? (courseIdOrObj.description || '') : (description || '');
      const chId = typeof courseIdOrObj === 'object' && courseIdOrObj.id ? courseIdOrObj.id : `ch-${Date.now()}`;
      const count = draft.chapters.filter(ch => ch.courseId === courseId).length;
      draft.chapters.push({
        id: chId,
        courseId,
        title: chTitle,
        description: chDesc,
        order: count + 1,
      });
    }, { action: 'CREATE_CHAPTER', entityType: 'Chapter', entityId: typeof courseIdOrObj === 'object' ? courseIdOrObj.courseId : courseIdOrObj });
    return { ok: true };
  };

  const updateChapter = (chapterId: string, updates: any) => {
    updateDb((draft) => {
      const ch = draft.chapters.find(x => x.id === chapterId);
      if (ch) {
        Object.assign(ch, updates);
      }
    }, { action: 'UPDATE_CHAPTER', entityType: 'Chapter', entityId: chapterId });
    return { ok: true };
  };

  const deleteChapter = (chapterId: string) => {
    updateDb((draft) => {
      draft.chapters = draft.chapters.filter(x => x.id !== chapterId);
      draft.lessons = draft.lessons.filter(x => x.chapterId !== chapterId);
    }, { action: 'DELETE_CHAPTER', entityType: 'Chapter', entityId: chapterId });
    return { ok: true };
  };

  const createLesson = (chapterIdOrObj: any, title?: string, description?: string) => {
    updateDb((draft) => {
      const chapterId = typeof chapterIdOrObj === 'object' ? chapterIdOrObj.chapterId : chapterIdOrObj;
      const lTitle = typeof chapterIdOrObj === 'object' ? chapterIdOrObj.title : (title || '');
      const lDesc = typeof chapterIdOrObj === 'object' ? (chapterIdOrObj.description || '') : (description || '');
      const lId = typeof chapterIdOrObj === 'object' && chapterIdOrObj.id ? chapterIdOrObj.id : `les-${Date.now()}`;
      const ch = draft.chapters.find(x => x.id === chapterId);
      const count = draft.lessons.filter(l => l.chapterId === chapterId).length;
      draft.lessons.push({
        id: lId,
        courseId: ch ? ch.courseId : '',
        chapterId,
        title: lTitle,
        description: lDesc,
        order: count + 1,
      });
    }, { action: 'CREATE_LESSON', entityType: 'Lesson', entityId: typeof chapterIdOrObj === 'object' ? chapterIdOrObj.chapterId : chapterIdOrObj });
    return { ok: true };
  };

  const updateLesson = (lessonId: string, updates: any) => {
    updateDb((draft) => {
      const l = draft.lessons.find(x => x.id === lessonId);
      if (l) {
        Object.assign(l, updates);
      }
    }, { action: 'UPDATE_LESSON', entityType: 'Lesson', entityId: lessonId });
    return { ok: true };
  };

  const deleteLesson = (lessonId: string) => {
    updateDb((draft) => {
      draft.lessons = draft.lessons.filter(x => x.id !== lessonId);
    }, { action: 'DELETE_LESSON', entityType: 'Lesson', entityId: lessonId });
    return { ok: true };
  };

  const updateAIDraft = (id: string, updates: any) => {
    updateDb((draft) => {
      const d = draft.aiDrafts.find((x) => x.id === id);
      if (d) {
        Object.assign(d, updates);
        if (updates.status === 'confirmed' && (updates.text || d.text)) {
          const summaryText = (updates.text || d.text || '').trim();
          if (summaryText) {
            if (d.sourceVersionIds && d.sourceVersionIds.length > 0) {
              for (const vId of d.sourceVersionIds) {
                const mv = draft.materialVersions.find((v) => v.id === vId);
                if (mv) mv.summary = summaryText;
              }
            } else if ((d as any).materialId) {
              const mat = draft.materials.find((m) => m.id === (d as any).materialId);
              if (mat?.currentVersionId) {
                const mv = draft.materialVersions.find((v) => v.id === mat.currentVersionId);
                if (mv) mv.summary = summaryText;
              }
            }
          }
        }
      }
    }, { action: 'UPDATE_AI_DRAFT', entityType: 'AIDraft', entityId: id });
    return { ok: true };
  };

  const lockAccount = (userId: string) => {
    const session = storageManager.getSession();
    if (session && session.userId === userId && session.role === 'admin') {
      return { ok: false, error: { message: 'Không thể tự khóa tài khoản của chính mình' } };
    }
    updateDb((draft) => {
      const u = draft.users.find((x) => x.id === userId);
      if (u) {
        u.status = 'locked';
      }
    }, { action: 'LOCK_USER', entityType: 'User', entityId: userId });
    return { ok: true };
  };

  const unlockAccount = (userId: string) => {
    updateDb((draft) => {
      const u = draft.users.find(x => x.id === userId);
      if (u) {
        u.status = 'active';
      }
    }, { action: 'UNLOCK_USER', entityType: 'User', entityId: userId });
    return { ok: true };
  };

  const changeUserRole = (userId: string, newRole: UserRole) => {
    const session = storageManager.getSession();
    if (session && session.userId === userId && session.role === 'admin') {
      return { ok: false, error: { message: 'Không thể tự thay đổi vai trò của chính mình' } };
    }
    updateDb((draft) => {
      const u = draft.users.find((x) => x.id === userId);
      if (u) {
        u.role = newRole;
      }
    }, { action: 'CHANGE_USER_ROLE', entityType: 'User', entityId: userId });
    return { ok: true };
  };

  const addEligibleEmails = (newEmails: any[]) => {
    updateDb((draft) => {
      for (const item of newEmails) {
        const emailNorm = (item.emailNormalized || item.email || '').toLowerCase().trim();
        if (!emailNorm) continue;
        const exists = draft.validEmails.some(e => e.emailNormalized === emailNorm);
        if (!exists) {
          draft.validEmails.push({
            emailNormalized: emailNorm,
            fullName: item.fullName || item.name || emailNorm.split('@')[0],
            assignedRole: item.assignedRole || item.role || 'student',
            addedAt: demoClock.now(),
          });
        }
      }
    }, { action: 'ADD_ELIGIBLE_EMAILS', entityType: 'ValidEmail', entityId: 'bulk' });
    return { ok: true };
  };

  const deleteEligibleEmail = (email: string) => {
    updateDb((draft) => {
      const norm = email.toLowerCase().trim();
      draft.validEmails = draft.validEmails.filter(e => e.emailNormalized !== norm && (e as any).id !== email);
    }, { action: 'DELETE_ELIGIBLE_EMAIL', entityType: 'ValidEmail', entityId: email });
    return { ok: true };
  };

  const updateSystemSettings = (updates: Partial<SystemSettings>) => {
    updateDb((draft) => {
      Object.assign(draft.settings, updates);
    }, { action: 'UPDATE_SETTINGS', entityType: 'SystemSettings', entityId: 'global' });
    return { ok: true };
  };

  const markAnnouncementAsRead = (id: string) => {
    const session = storageManager.getSession();
    const userId = session?.userId || 'u-sv1';
    updateDb((draft) => {
      const a = draft.announcements.find(x => x.id === id);
      if (a && !a.readByUserIds.includes(userId)) {
        a.readByUserIds.push(userId);
      }
    });
  };

  const markAllAnnouncementsAsRead = () => {
    const session = storageManager.getSession();
    const userId = session?.userId || 'u-sv1';
    updateDb((draft) => {
      for (const a of draft.announcements) {
        if (!a.readByUserIds.includes(userId)) {
          a.readByUserIds.push(userId);
        }
      }
    });
  };

  const createAnnouncement = (ann: any) => {
    const session = storageManager.getSession();
    const id = ann.id || `ann-${Date.now()}`;
    const shouldSendEmail = Boolean(ann.sendEmail ?? true);
    updateDb((draft) => {
      draft.announcements.unshift({
        id,
        courseId: ann.courseId,
        title: ann.title,
        body: ann.body || ann.content || '',
        authorId: ann.authorId || session?.userId || 'u-gv1',
        publishedAt: demoClock.now(),
        readByUserIds: [session?.userId || 'u-gv1'],
      });
      if (shouldSendEmail && draft.settings.emailEnabled) {
        draft.emailJobs.push({
          id: `job-${Date.now()}`,
          type: 'announcement',
          entityId: id,
          status: 'queued',
          recipients: draft.memberships.filter((m) => m.courseId === ann.courseId && m.status === 'active').map((m) => m.emailNormalized),
          failedRecipients: [],
          attempts: 1,
        });
      }
    }, { action: 'CREATE_ANNOUNCEMENT', entityType: 'Announcement', entityId: id });
    return { ok: true };
  };

  const retryFailedEmailJobs = (jobId?: string) => {
    updateDb((draft) => {
      for (const job of draft.emailJobs) {
        if (jobId && job.id !== jobId) continue;
        if (job.status === 'partial_error' || (job.status as any) === 'failed') {
          job.status = 'success';
          job.failedRecipients = [];
          job.attempts = (job.attempts || 0) + 1;
        }
      }
    }, { action: 'RETRY_EMAIL_JOBS', entityType: 'EmailJob', entityId: jobId || 'all' });
    return { ok: true };
  };

  const submitAssignment = (assignmentId: string, studentId: string, fileData: any) => {
    const filename = typeof fileData === 'string' ? fileData : fileData?.name || fileData?.filename || 'submission.zip';
    const sizeBytes = typeof fileData === 'object' && fileData?.size ? fileData.size : 1024 * 512;
    const now = demoClock.now();
    updateDb((draft) => {
      const ass = draft.assignments.find((a) => a.id === assignmentId);
      const isLate = ass ? now > ass.dueAt : false;
      const sub = draft.submissions.find((s) => s.assignmentId === assignmentId && s.studentId === studentId);
      const revId = `subrev-${Date.now()}`;
      const revNum = sub ? sub.revisions.length + 1 : 1;
      const newRev = {
        id: revId,
        revisionNumber: revNum,
        filename,
        mime: 'application/octet-stream',
        sizeBytes,
        submittedAt: now,
        isLate,
        fileHash: `sha256-${Date.now()}`,
      };

      if (sub) {
        sub.revisions.push(newRev);
        sub.submittedAt = now;
        sub.latestRevisionId = revId;
        sub.gradingStatus = 'ungraded';
      } else {
        const subId = `sub-${Date.now()}`;
        draft.submissions.push({
          id: subId,
          assignmentId,
          studentId,
          revisions: [newRev],
          submittedAt: now,
          latestRevisionId: revId,
          isLate,
          gradingStatus: 'ungraded',
        });
      }
    }, { action: 'SUBMIT_ASSIGNMENT', entityType: 'Submission', entityId: assignmentId });
    return { ok: true };
  };

  const createAssignment = (ass: any) => {
    const id = ass.id || `ass-${Date.now()}`;
    updateDb((draft) => {
      draft.assignments.push({
        id,
        courseId: ass.courseId,
        title: ass.title,
        instructions: ass.instructions || ass.description || '',
        attachments: ass.attachments || [],
        rubricCriteria: ass.rubricCriteria || ass.rubric || [],
        maxScore: ass.maxScore || 10,
        dueAt: ass.dueAt || ass.dueDate || new Date().toISOString(),
        allowLate: ass.allowLate ?? true,
        status: ass.status || 'published',
      });
    }, { action: 'CREATE_ASSIGNMENT', entityType: 'Assignment', entityId: id });
    return { ok: true };
  };

  const updateAssignment = (id: string, updates: any) => {
    updateDb((draft) => {
      const a = draft.assignments.find(x => x.id === id);
      if (a) {
        if (updates.dueDate) updates.dueAt = updates.dueDate;
        if (updates.description) updates.instructions = updates.description;
        if (updates.rubric) updates.rubricCriteria = updates.rubric;
        Object.assign(a, updates);
      }
    }, { action: 'UPDATE_ASSIGNMENT', entityType: 'Assignment', entityId: id });
    return { ok: true };
  };

  return (
    <DatabaseContext.Provider
      value={{
        db,
        updateDb,
        resetDb,
        isMemoryOnly,
        users: db.users,
        validEmails: db.validEmails,
        courses: db.courses,
        memberships: db.memberships,
        chapters: db.chapters,
        lessons: db.lessons,
        materials: db.materials,
        materialVersions: db.materialVersions,
        assignments: db.assignments,
        submissions: db.submissions,
        gradeRevisions: db.gradeRevisions,
        announcements: db.announcements,
        emailJobs: db.emailJobs,
        aiDrafts: db.aiDrafts,
        auditLogs: db.auditLogs,
        auditEvents: db.auditLogs,
        settings: db.settings,
        systemSettings: db.settings,
        addMembers,
        withdrawMembership,
        restoreMembership,
        publishGrade,
        saveGradeDraft,
        archiveCourse,
        transferCourseTeacher,
        createCourse,
        createChapter,
        updateChapter,
        deleteChapter,
        createLesson,
        updateLesson,
        deleteLesson,
        createMaterial,
        addMaterialVersion,
        updateMaterial,
        createAIDraft,
        updateAIDraft,
        lockAccount,
        unlockAccount,
        changeUserRole,
        addEligibleEmails,
        deleteEligibleEmail,
        updateSystemSettings,
        markAnnouncementAsRead,
        markAllAnnouncementsAsRead,
        createAnnouncement,
        retryFailedEmailJobs,
        submitAssignment,
        createAssignment,
        updateAssignment,
      }}
    >
      {children}
    </DatabaseContext.Provider>
  );
};

export const useDatabase = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within DatabaseProvider');
  }
  return context;
};
