export type UserRole = 'admin' | 'teacher' | 'student';
export type UserStatus = 'active' | 'locked';

export interface User {
  id: string;
  fullName: string;
  emailNormalized: string;
  role: UserRole;
  status: UserStatus;
  code: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface ValidEmail {
  emailNormalized: string;
  fullName: string;
  assignedRole: 'teacher' | 'student';
  registeredUserId?: string;
  addedAt: string;
}

export type CourseStatus = 'open' | 'archived';

export interface Course {
  id: string;
  code: string; // Uppercase, unique
  name: string;
  term: string;
  description: string;
  teacherId: string;
  status: CourseStatus;
  archivedAt?: string;
}

export type MembershipStatus = 'active' | 'pending' | 'withdrawn';

export interface Membership {
  id: string;
  courseId: string;
  emailNormalized: string;
  userId?: string;
  status: MembershipStatus;
  addedAt: string;
  withdrawnAt?: string;
}

export interface Chapter {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
}

export interface Lesson {
  id: string;
  courseId: string;
  chapterId: string;
  title: string;
  description: string;
  order: number;
}

export type MaterialVisibility = 'draft' | 'class' | 'hidden';
export type ScanStatus = 'pending' | 'running' | 'clean' | 'infected' | 'error';
export type ExtractionStatus = 'pending' | 'running' | 'success' | 'no_text' | 'error';
export type IndexStatus = 'pending' | 'running' | 'success' | 'error';

export interface MaterialVersion {
  id: string;
  materialId: string;
  versionNumber: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  scanStatus: ScanStatus;
  extractionStatus: ExtractionStatus;
  indexStatus: IndexStatus;
  summary?: string;
  demoAssetId?: string;
  contentExcerpt?: string;
}

export interface Material {
  id: string;
  courseId: string;
  lessonId: string;
  title: string;
  tags: string[];
  visibility: MaterialVisibility;
  currentVersionId: string;
  publishedVersionIds: string[];
}

export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  maxScore: number;
}

export type AssignmentStatus = 'draft' | 'published' | 'archived';

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  instructions: string;
  attachments: { name: string; sizeBytes: number; assetId?: string }[];
  rubricCriteria: RubricCriterion[];
  maxScore: number;
  dueAt: string;
  allowLate: boolean;
  manuallyClosedAt?: string;
  status: AssignmentStatus;
}

export interface SubmissionRevision {
  id: string;
  revisionNumber: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  submittedAt: string;
  isLate: boolean;
  fileHash?: string;
}

export type GradingStatus = 'ungraded' | 'in_progress' | 'graded';

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  revisions: SubmissionRevision[];
  submittedAt: string;
  latestRevisionId: string;
  isLate: boolean;
  gradingStatus: GradingStatus;
}

export type GradeRevisionStatus = 'draft' | 'published';

export interface GradeRevision {
  id: string;
  submissionId: string;
  submissionRevisionId: string;
  criterionScores: { criterionId: string; score: number }[];
  feedback: string;
  total: number;
  status: GradeRevisionStatus;
  authorId: string;
  createdAt: string;
  publishedAt?: string;
}

export interface Announcement {
  id: string;
  courseId: string;
  title: string;
  body: string;
  authorId: string;
  publishedAt: string;
  readByUserIds: string[];
  emailJobId?: string;
}

export type EmailJobStatus = 'not_requested' | 'disabled' | 'queued' | 'success' | 'partial_error';

export interface EmailJob {
  id: string;
  type: 'announcement' | 'assignment' | 'grade';
  entityId: string;
  status: EmailJobStatus;
  recipients: string[];
  failedRecipients: string[];
  attempts: number;
}

export type AIDraftType = 'summary' | 'assignment';
export type AIDraftStatus = 'pending' | 'confirmed' | 'discarded';

export interface AIDraft {
  id: string;
  courseId: string;
  sourceVersionIds: string[];
  type: AIDraftType;
  title?: string;
  text?: string;
  structuredContent?: {
    title?: string;
    instructions?: string;
    rubricCriteria?: { title: string; description: string; maxScore: number }[];
  };
  status: AIDraftStatus;
  createdAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  result: 'success' | 'denied' | 'failed';
  redactedDetails?: string;
}

export interface SystemSettings {
  studentSubmissionFormats: string[];
  maxSubmissionFileMB: number;
  aiEnabled: boolean;
  studentDailyAIQuota: number;
  teacherMonthlyAIQuota: number;
  emailEnabled: boolean;
}
