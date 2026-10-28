import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate, useOutletContext } from 'react-router-dom';
import {
  assignmentsService,
  type AssignmentDetail,
} from '../../../api/assignmentsService';
import { filesService, type StoredFile } from '../../../api/filesService';
import { coursesService, type Course, type Chapter } from '../../../api/coursesService';
import { ApiError } from '../../../api/client';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField, TextAreaField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Modal } from '../../../shared/ui/Modal';
import { Badge } from '../../../shared/ui/Badge';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { formatScoreVN, formatFileSize } from '../../../shared/kernel/formatting';
import {
  FileText,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Upload,
  Download,
  Paperclip,
  Loader2,
} from 'lucide-react';
import './TeacherAssignmentEditPage.css';

export interface RubricItemState {
  id: string;
  title: string;
  description: string;
  maxScore: number;
}

export interface AttachmentState {
  id: string;
  fileId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  downloadUrl?: string;
  previewUrl?: string;
}

export const TeacherAssignmentEditPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const outletContext = useOutletContext<{ course?: Course; isArchived?: boolean } | null>();
  const [searchParams] = useSearchParams();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const editAssignmentId = searchParams.get('baiTap');

  // Course state
  const [course, setCourse] = useState<Course | null>(outletContext?.course || null);
  const [courseLoading, setCourseLoading] = useState(!outletContext?.course);
  const isArchived = Boolean(outletContext?.isArchived || course?.status === 'archived');

  // Chapters
  const [chapters, setChapters] = useState<Chapter[]>([]);

  // Existing assignment
  const [existingAssignment, setExistingAssignment] = useState<AssignmentDetail | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(Boolean(editAssignmentId));
  const [assignmentVersion, setAssignmentVersion] = useState<number | undefined>(undefined);
  const [staleConflictError, setStaleConflictError] = useState<string | null>(null);

  // Tabs: 'soan' | 'xem-truoc'
  const [activeTab, setActiveTab] = useState<'soan' | 'xem-truoc'>('soan');

  // Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chapterId, setChapterId] = useState<string>('');

  // Default dynamic due date: 7 days from today
  const defaultDueDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  }, []);

  const [dueDateStr, setDueDateStr] = useState(defaultDueDate);
  const [dueTimeStr, setDueTimeStr] = useState('23:59');
  const [allowLate, setAllowLate] = useState(false);

  // File Policy Fields
  const [maxFiles, setMaxFiles] = useState(1);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(25);
  const [allowedExtsStr, setAllowedExtsStr] = useState('pdf, docx');

  // Attachments State
  const [attachments, setAttachments] = useState<AttachmentState[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<
    Array<{ fileName: string; status: 'uploading' | 'scanning' | 'clean' | 'error'; errorMsg?: string }>
  >([]);
  const hasPendingFiles = uploadingFiles.length > 0;

  // Rubric State
  const [rubricItems, setRubricItems] = useState<RubricItemState[]>([
    {
      id: 'cr-default-1',
      title: 'Tính đúng đắn và đầy đủ chức năng',
      maxScore: 5,
      description: 'Hoàn thành toàn bộ ca kiểm thử chức năng yêu cầu',
    },
    {
      id: 'cr-default-2',
      title: 'Kiến trúc mã nguồn và phong cách viết',
      maxScore: 3,
      description: 'Phân tách module rõ ràng, clean code',
    },
    {
      id: 'cr-default-3',
      title: 'Tài liệu hướng dẫn và báo cáo kiểm thử',
      maxScore: 2,
      description: 'Tài liệu Markdown chuẩn, bằng chứng kết quả kiểm thử',
    },
  ]);

  // AI Drawer state (honest representation)
  const [showAiDrawer, setShowAiDrawer] = useState(false);

  // Publish Confirm Modal
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Published lock check
  const isAlreadyPublished = Boolean(existingAssignment && existingAssignment.status !== 'draft');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const intents = useRef(new Map<string, string>());
  const creationKey = useRef(crypto.randomUUID());
  const notifyErrorRef = useRef(notifyError);
  notifyErrorRef.current = notifyError;
  const loadSequence = useRef(0);
  const isAssignmentArchived = existingAssignment?.status === 'archived';
  const isReadOnly = isArchived || isAssignmentArchived;

  // Total score calculation
  const totalScore = useMemo(() => {
    return rubricItems.reduce((acc, item) => acc + (Number(item.maxScore) || 0), 0);
  }, [rubricItems]);

  // Fetch course if needed
  useEffect(() => {
    if (!monId || outletContext?.course) {
      if (outletContext?.course) setCourse(outletContext.course);
      setCourseLoading(false);
      return;
    }

    let isMounted = true;
    setCourseLoading(true);
    coursesService
      .get(monId)
      .then((c) => {
        if (isMounted) setCourse(c);
      })
      .catch(() => {
        if (isMounted) setCourse(null);
      })
      .finally(() => {
        if (isMounted) setCourseLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [monId, outletContext?.course]);

  // Fetch chapters
  useEffect(() => {
    if (!monId) return;
    let isMounted = true;
    coursesService
      .listChapters(monId)
      .then((chs) => {
        if (isMounted) setChapters(chs);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [monId]);

  // Fetch existing assignment if editing
  const loadExistingAssignment = useCallback(async () => {
    if (!monId || !editAssignmentId) return;
    const sequence = ++loadSequence.current;

    setAssignmentLoading(true);
    setStaleConflictError(null);

    try {
      const ass = await assignmentsService.getTeacherAssignment(monId, editAssignmentId);
      if (!mounted.current || sequence !== loadSequence.current) return;
      setExistingAssignment(ass);
      setAssignmentVersion(ass.version);

      setTitle(ass.title);
      setDescription(ass.instructions);
      setChapterId(ass.chapter_id || '');

      if (ass.due_at) {
        const local = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).format(new Date(ass.due_at)).split(' ');
        setDueDateStr(local[0]);
        setDueTimeStr(local[1]);
      }

      setAllowLate(ass.allow_late);

      if (ass.file_policy) {
        if (ass.file_policy.max_files_per_submission) {
          setMaxFiles(ass.file_policy.max_files_per_submission);
        }
        if (ass.file_policy.max_file_size_bytes) {
          setMaxFileSizeMb(Math.round(ass.file_policy.max_file_size_bytes / (1024 * 1024)));
        }
        if (Array.isArray(ass.file_policy.allowed_extensions)) {
          setAllowedExtsStr((ass.file_policy.allowed_extensions as string[]).join(', '));
        }
      }

      if (ass.attachments) {
        setAttachments(
          ass.attachments.map((att) => ({
            id: att.id,
            fileId: att.file_id,
            name: att.name,
            sizeBytes: att.size_bytes,
            mimeType: att.mime_type || 'application/octet-stream',
            downloadUrl: att.download_url,
            previewUrl: att.preview_url ?? undefined,
          }))
        );
      }

      if (ass.rubric_criteria && ass.rubric_criteria.length > 0) {
        setRubricItems(
          ass.rubric_criteria.map((c) => ({
            id: c.id,
            title: c.title,
            description: c.description || '',
            maxScore: Number(c.max_score),
          }))
        );
      }
    } catch (err) {
      if (mounted.current && sequence === loadSequence.current) notifyErrorRef.current(err instanceof Error ? err.message : 'Không thể tải thông tin bài tập.');
    } finally {
      if (mounted.current && sequence === loadSequence.current) setAssignmentLoading(false);
    }
  }, [monId, editAssignmentId]);

  useEffect(() => {
    void loadExistingAssignment();
    return () => { loadSequence.current++; };
  }, [loadExistingAssignment]);

  if (courseLoading || assignmentLoading) {
    return (
      <div className="teacher-ass-edit-container">
        <LoadingSkeleton />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="teacher-ass-edit-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại trên hệ thống hoặc bạn không có quyền truy cập."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  if (editAssignmentId && !existingAssignment) {
    return (
      <div className="teacher-ass-edit-container">
        <EmptyState
          title="Không tìm thấy bài tập"
          description="Bài tập bạn yêu cầu chỉnh sửa không tồn tại."
          action={
            <Button
              variant="secondary"
              onClick={() => navigate(`/gv/mon-hoc/${course.id}/bai-tap`)}
            >
              Về danh sách bài tập
            </Button>
          }
        />
      </div>
    );
  }

  // RUBRIC HANDLERS
  const handleAddCriterion = () => {
    if (isAlreadyPublished || isReadOnly) return;
    const newItem: RubricItemState = {
      id: `cr-${Date.now()}`,
      title: 'Tiêu chí đánh giá mới',
      maxScore: 1,
      description: 'Mô tả yêu cầu đạt điểm tối đa',
    };
    setRubricItems((prev) => [...prev, newItem]);
  };

  const handleUpdateCriterion = (id: string, updates: Partial<RubricItemState>) => {
    if (isAlreadyPublished || isReadOnly) return;
    setRubricItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleDeleteCriterion = (id: string) => {
    if (isAlreadyPublished || isReadOnly) return;
    if (rubricItems.length <= 1) {
      notifyError('Bài tập phải có ít nhất một tiêu chí chấm điểm trong rubric.');
      return;
    }
    setRubricItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleMoveCriterion = (index: number, dir: 'up' | 'down') => {
    if (isAlreadyPublished || isReadOnly) return;
    const targetIdx = dir === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= rubricItems.length) return;

    const list = [...rubricItems];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    setRubricItems(list);
  };

  // REAL ATTACHMENT UPLOAD (B10-03 + B08 Files API)
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isAlreadyPublished || isReadOnly) return;
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const file = fileList[0];
    const fileName = file.name;
    const fileSize = file.size;

    setUploadingFiles((prev) => [...prev, { fileName, status: 'uploading' }]);

    try {
      // 1. Create upload intent
      let targetAssignmentId = existingAssignment?.id;
      if (!targetAssignmentId) {
        const payload = buildPayload();
        if (!payload.trimmedTitle) throw new Error('Nhập tiêu đề trước khi tải tệp đính kèm.');
        const draft = await assignmentsService.createAssignment(course.id, {
          title: payload.trimmedTitle,
          instructions: description.trim(),
          due_at: payload.fullDueDate,
          allow_late: allowLate,
          chapter_id: chapterId || null,
          rubric_criteria: payload.rubricCriteria,
          file_policy: payload.filePolicy,
          ai_grading_opt_in: false,
          publish_immediately: false,
        }, { idempotencyKey: creationKey.current });
        targetAssignmentId = draft.id;
        setExistingAssignment(draft);
        setAssignmentVersion(draft.version);
        navigate(`/gv/mon-hoc/${course.id}/bai-tap/soan?baiTap=${draft.id}`, { replace: true });
      }
      const uploadKey = `${file.name}:${file.size}:${file.lastModified}`;
      const priorId = intents.current.get(uploadKey);
      const intent = priorId ? { file_id: priorId } : await filesService.createUploadIntent(course.id, {
        file_name: fileName,
        file_size: fileSize,
        purpose: 'assignment_attachment',
        assignment_id: targetAssignmentId,
      });
      intents.current.set(uploadKey, intent.file_id);
      const prior = priorId ? await filesService.getFile(course.id, priorId) : null;

      // 2. Upload binary content
      if (!prior || prior.status === 'quarantine_pending') {
      await filesService.uploadContent(course.id, intent.file_id, file);

      // 3. Commit upload
      setUploadingFiles((prev) =>
        prev.map((f) => (f.fileName === fileName ? { ...f, status: 'scanning' } : f))
      );
      await filesService.commitUpload(course.id, intent.file_id);
      }

      // 4. Poll/verify scan status
      let storedFile: StoredFile | null = null;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (!mounted.current) return;
        storedFile = await filesService.getFile(course.id, intent.file_id);
        if (storedFile.status === 'clean' || storedFile.status === 'infected') {
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (!storedFile || storedFile.status !== 'clean') {
        const errorMsg =
          storedFile?.status === 'infected'
            ? 'Tệp tải lên phát hiện mã độc (Infected) và đã bị hệ thống cách ly!'
            : 'Tệp tải lên chưa vượt qua vòng kiểm duyệt bảo mật.';
        notifyError(errorMsg);
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.fileName === fileName ? { ...f, status: 'error', errorMsg } : f
          )
        );
        return;
      }

      // 5. Add to local attachments
      if (!mounted.current) return;
      setAttachments((prev) => [
        ...prev.filter(att => att.fileId !== intent.file_id),
        {
          id: `att-${Date.now()}`,
          fileId: intent.file_id,
          name: fileName,
          sizeBytes: fileSize,
          mimeType: file.type || 'application/octet-stream',
          downloadUrl: `/api/v1/courses/${course.id}/files/${intent.file_id}/download`,
          previewUrl: `/api/v1/courses/${course.id}/files/${intent.file_id}/preview`,
        },
      ]);

      setUploadingFiles((prev) => prev.filter((f) => f.fileName !== fileName));
      notifySuccess(`Đã tải lên và quét an toàn tệp "${fileName}".`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Lỗi tải lên tệp đính kèm.';
      notifyError(errorMsg);
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.fileName === fileName ? { ...f, status: 'error', errorMsg } : f
        )
      );
    } finally {
      // Clear input value to allow re-uploading same file
      try {
        event.target.value = '';
      } catch {
        // Safe fallback for testing environments (jsdom)
      }
    }
  };

  const handleRemoveAttachment = (fileId: string) => {
    if (isAlreadyPublished || isReadOnly) return;
    setAttachments((prev) => prev.filter((att) => att.fileId !== fileId));
  };

  // BUILD PAYLOAD HELPER
  const buildPayload = () => {
    const trimmedTitle = title.trim();
    const fullDueDate = `${dueDateStr}T${dueTimeStr}:00+07:00`;

    const exts = allowedExtsStr
      .split(',')
      .map((s) => s.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);

    const rubricCriteria = rubricItems.map((item, idx) => ({
      id: item.id.startsWith('cr-') ? undefined : item.id,
      title: item.title.trim(),
      description: item.description.trim(),
      max_score: String(item.maxScore),
      position: idx + 1,
    }));

    const filePolicy = {
      max_files_per_submission: Number(maxFiles) || 1,
      max_file_size_bytes: (Number(maxFileSizeMb) || 25) * 1024 * 1024,
      allowed_extensions: exts,
    };

    const attachmentFileIds = attachments.map((att) => att.fileId);

    return {
      trimmedTitle,
      fullDueDate,
      rubricCriteria,
      filePolicy,
      attachmentFileIds,
    };
  };

  // SAVE AS DRAFT
  const handleSaveDraft = async () => {
    if (isReadOnly) return;
    const { trimmedTitle, fullDueDate, rubricCriteria, filePolicy, attachmentFileIds } =
      buildPayload();

    if (!trimmedTitle) {
      notifyError('Vui lòng nhập tiêu đề bài tập.');
      return;
    }

    setIsSubmitting(true);
    setStaleConflictError(null);

    try {
      if (existingAssignment) {
        // Update existing draft
        await assignmentsService.updateAssignment(
          course.id,
          existingAssignment.id,
          {
            title: trimmedTitle,
            instructions: description.trim(),
            due_at: fullDueDate,
            allow_late: allowLate,
            chapter_id: chapterId || null,
            rubric_criteria: rubricCriteria,
            file_policy: filePolicy,
            attachment_file_ids: attachmentFileIds,
            expected_version: assignmentVersion,
          },
          { ifMatch: assignmentVersion }
        );
        notifySuccess('Đã lưu cập nhật bản nháp bài tập thành công.');
      } else {
        // Create new draft
        await assignmentsService.createAssignment(course.id, {
          title: trimmedTitle,
          instructions: description.trim(),
          due_at: fullDueDate,
          allow_late: allowLate,
          chapter_id: chapterId || null,
          rubric_criteria: rubricCriteria,
          file_policy: filePolicy,
          attachment_file_ids: attachmentFileIds,
          publish_immediately: false,
          ai_grading_opt_in: false,
        }, { idempotencyKey: creationKey.current });
        notifySuccess('Đã tạo bản nháp bài tập mới thành công.');
      }

      navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStaleConflictError(
          'Dữ liệu bài tập đã được cập nhật bởi một phiên làm việc khác (Xung đột phiên bản OCC). Vui lòng làm mới dữ liệu để xem phiên bản mới nhất.'
        );
      } else {
        notifyError(err instanceof Error ? err.message : 'Lỗi khi lưu bản nháp.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // SAVE POST-PUBLISH SETTINGS
  const handleSavePublishedSettings = async () => {
    if (isReadOnly || !existingAssignment) return;
    const { fullDueDate, filePolicy } = buildPayload();

    setIsSubmitting(true);
    setStaleConflictError(null);

    try {
      await assignmentsService.updateAssignment(
        course.id,
        existingAssignment.id,
        {
          due_at: fullDueDate,
          allow_late: allowLate,
          file_policy: filePolicy,
          expected_version: assignmentVersion,
        },
        { ifMatch: assignmentVersion }
      );
      notifySuccess('Đã lưu cập nhật hạn nộp và thiết lập bài tập.');
      navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStaleConflictError(
          'Dữ liệu bài tập đã được cập nhật bởi một phiên làm việc khác (Xung đột phiên bản OCC). Vui lòng làm mới trang.'
        );
      } else {
        notifyError(err instanceof Error ? err.message : 'Lỗi khi cập nhật thiết lập bài tập.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // CONFIRM PUBLISH (ATOMIC & IMMUTABLE)
  const handleConfirmPublish = async () => {
    if (isReadOnly) return;
    const { trimmedTitle, fullDueDate, rubricCriteria, filePolicy, attachmentFileIds } =
      buildPayload();

    if (!trimmedTitle) {
      notifyError('Vui lòng nhập tiêu đề bài tập.');
      return;
    }

    if (rubricItems.length === 0) {
      notifyError('Bài tập phải có ít nhất một tiêu chí Rubric trước khi công bố.');
      return;
    }

    setIsSubmitting(true);
    setStaleConflictError(null);

    try {
      if (existingAssignment) {
        // Save updates to draft first, then publish
        const saved = await assignmentsService.updateAssignment(
          course.id,
          existingAssignment.id,
          {
            title: trimmedTitle,
            instructions: description.trim(),
            due_at: fullDueDate,
            allow_late: allowLate,
            chapter_id: chapterId || null,
            rubric_criteria: rubricCriteria,
            file_policy: filePolicy,
            attachment_file_ids: attachmentFileIds,
            expected_version: assignmentVersion,
          },
          { ifMatch: assignmentVersion }
        );

        await assignmentsService.publishAssignment(course.id, existingAssignment.id, { expected_version: saved.version }, { idempotencyKey: 'publish-' + creationKey.current });
      } else {
        // Direct create & publish immediately
        await assignmentsService.createAssignment(course.id, {
          title: trimmedTitle,
          instructions: description.trim(),
          due_at: fullDueDate,
          allow_late: allowLate,
          chapter_id: chapterId || null,
          rubric_criteria: rubricCriteria,
          file_policy: filePolicy,
          attachment_file_ids: attachmentFileIds,
          publish_immediately: true,
          ai_grading_opt_in: false,
        }, { idempotencyKey: creationKey.current });
      }

      setShowPublishModal(false);
      notifySuccess(`Đã công bố bài tập "${trimmedTitle}" thành công cho sinh viên.`);
      navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStaleConflictError(
          'Dữ liệu bài tập đã được cập nhật bởi một phiên làm việc khác (Xung đột phiên bản OCC). Vui lòng làm mới trang.'
        );
      } else {
        notifyError(err instanceof Error ? err.message : 'Lỗi khi công bố bài tập.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="teacher-ass-edit-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/gv' },
            { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
            { label: 'Bài tập', path: `/gv/mon-hoc/${course.id}/bai-tap` },
            {
              label: existingAssignment
                ? `Chỉnh sửa: ${existingAssignment.title}`
                : 'Soạn bài tập mới',
            },
          ]}
        />
        <div className="title-row">
          <h1 className="edit-main-title">
            {existingAssignment ? 'Chỉnh sửa bài tập' : 'Soạn bài tập mới'}
          </h1>
          {existingAssignment && (
            <Badge
              variant={
                existingAssignment.status === 'published'
                  ? 'published'
                  : existingAssignment.status === 'closed'
                    ? 'closed'
                    : existingAssignment.status === 'archived'
                      ? 'archived'
                      : 'draft'
              }
              label={
                existingAssignment.status === 'published'
                  ? 'Đã công bố'
                  : existingAssignment.status === 'closed'
                    ? 'Đã đóng nộp'
                    : existingAssignment.status === 'archived'
                      ? 'Đã lưu trữ'
                      : 'Bản nháp'
              }
            />
          )}
        </div>
      </div>

      {isReadOnly && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>Môn học hoặc bài tập đã lưu trữ: Toàn bộ thông tin ở chế độ chỉ đọc.</span>
        </div>
      )}

      {isAlreadyPublished && !isReadOnly && (
        <div className="published-lock-alert" role="alert">
          <Lock size={18} />
          <span>
            <strong>Bài tập đã được công bố:</strong> Tiêu đề, đề bài, tệp đính kèm và tiêu chí Rubric được khóa cố định để đảm bảo sự công bằng cho sinh viên đã nộp bài. Bạn chỉ có thể điều chỉnh <strong>Hạn nộp</strong>, <strong>Cho phép nộp muộn</strong> và <strong>Chính sách tệp nộp bài</strong>.
          </span>
        </div>
      )}

      {staleConflictError && (
        <ErrorBanner
          message={staleConflictError}
          onRetry={() => void loadExistingAssignment()}
        />
      )}

      {/* Tabs */}
      <div className="edit-tabs-bar" role="tablist">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'soan' ? 'active' : ''}`}
          onClick={() => setActiveTab('soan')}
          role="tab"
          aria-selected={activeTab === 'soan'}
        >
          <FileText size={16} />
          <span>Soạn thảo bài tập</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'xem-truoc' ? 'active' : ''}`}
          onClick={() => setActiveTab('xem-truoc')}
          role="tab"
          aria-selected={activeTab === 'xem-truoc'}
        >
          <Eye size={16} />
          <span>Xem trước như sinh viên</span>
        </button>
      </div>

      {/* TAB 1: SOẠN THẢO */}
      {activeTab === 'soan' && (
        <div className="editor-layout">
          <div className="editor-main-form">
            {/* Statement Section */}
            <section className="form-section-card">
              <h2 className="section-title">Thông tin đề bài</h2>
              <div className="fields-stack">
                <TextField
                  label="Tiêu đề bài tập"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ví dụ: Bài tập lớn: Thiết kế hệ thống thông tin"
                  disabled={isAlreadyPublished || isReadOnly}
                />

                <TextAreaField
                  label="Yêu cầu đề bài & Hướng dẫn sinh viên"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả chi tiết yêu cầu, quy ước đặt tên, kịch bản nghiệp vụ..."
                  rows={6}
                  disabled={isAlreadyPublished || isReadOnly}
                />

                {chapters.length > 0 && (
                  <div className="form-group-item">
                    <label className="field-label">Gắn với chương học:</label>
                    <select
                      className="field-select"
                      value={chapterId}
                      onChange={(e) => setChapterId(e.target.value)}
                      disabled={isAlreadyPublished || isReadOnly}
                    >
                      <option value="">Không gắn với chương cụ thể</option>
                      {chapters.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-row-dates">
                  <TextField
                    label="Hạn nộp bài (Ngày)"
                    required
                    type="date"
                    value={dueDateStr}
                    onChange={(e) => setDueDateStr(e.target.value)}
                    disabled={isReadOnly}
                  />

                  <TextField
                    label="Giờ chót"
                    required
                    type="time"
                    value={dueTimeStr}
                    onChange={(e) => setDueTimeStr(e.target.value)}
                    disabled={isReadOnly}
                  />

                  <div className="checkbox-field-wrap">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={allowLate}
                        onChange={(e) => setAllowLate(e.target.checked)}
                        disabled={isReadOnly}
                      />
                      <span>Cho phép nộp muộn sau deadline</span>
                    </label>
                    <span className="checkbox-subtext">
                      Sinh viên nộp muộn sẽ được gắn nhãn nộp trễ và hiển thị rõ ràng khi chấm.
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Attachments Section */}
            <section className="form-section-card">
              <div className="section-header-row">
                <h2 className="section-title">Tệp đính kèm tài liệu đề bài</h2>
                <span className="section-desc">
                  Tài liệu đề bài được quét mã độc tự động trước khi công bố cho sinh viên.
                </span>
              </div>

              {/* Attachments List */}
              <div className="attachments-list-stack">
                {attachments.map((att) => (
                  <div key={att.fileId} className="attachment-item-row">
                    <div className="att-info-group">
                      <Paperclip size={16} className="att-icon" />
                      <span className="att-name">{att.name}</span>
                      <span className="att-size">({formatFileSize(att.sizeBytes)})</span>
                    </div>

                    <div className="att-actions-group">
                      {att.downloadUrl && (
                        <a
                          href={att.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="att-link-btn"
                          title="Tải về"
                        >
                          <Download size={15} />
                        </a>
                      )}
                      {!isAlreadyPublished && !isReadOnly && (
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => handleRemoveAttachment(att.fileId)}
                          title="Xóa tệp đính kèm này"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {uploadingFiles.map((up, idx) => (
                  <div key={idx} className="attachment-item-row uploading">
                    <div className="att-info-group">
                      {up.status === 'error' ? (
                        <AlertTriangle size={16} className="text-danger" />
                      ) : (
                        <Loader2 size={16} className="spinner-icon" />
                      )}
                      <span className="att-name">{up.fileName}</span>
                      <span className="att-status">
                        {up.status === 'uploading'
                          ? 'Đang tải lên...'
                          : up.status === 'scanning'
                            ? 'Đang quét mã độc (Antivirus)...'
                            : up.errorMsg || 'Lỗi tải lên'}
                      </span>
                      {up.status === 'error' && (
                        <button type="button" onClick={() => setUploadingFiles(prev => prev.filter((_, index) => index !== idx))}>
                          Bỏ tệp lỗi
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {!isAlreadyPublished && !isReadOnly && (
                <div className="upload-trigger-wrap">
                  <label className="npc-btn npc-btn-secondary file-upload-button">
                    <Upload size={16} />
                    <span>Tải lên tệp tài liệu đề</span>
                    <input
                      type="file"
                      className="hidden-file-input"
                      onChange={handleFileUpload}
                    />
                  </label>
                  <span className="upload-hint-text">
                    Hỗ trợ PDF, Word, Excel, ZIP. Tệp sẽ được tự động quét an toàn.
                  </span>
                </div>
              )}
            </section>

            {/* Submission File Policy Section */}
            <section className="form-section-card">
              <h2 className="section-title">Chính sách tệp nộp bài của sinh viên</h2>
              <p className="section-desc">
                Quy định định dạng và giới hạn dung lượng tệp sinh viên được phép nộp cho bài tập này.
              </p>

              <div className="form-row-dates">
                <TextField
                  label="Số tệp tối đa mỗi lần nộp"
                  type="number"
                  min="1"
                  max="10"
                  value={String(maxFiles)}
                  onChange={(e) => setMaxFiles(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                  disabled={isReadOnly}
                />

                <TextField
                  label="Dung lượng tối đa mỗi tệp (MB)"
                  type="number"
                  min="1"
                  max="100"
                  value={String(maxFileSizeMb)}
                  onChange={(e) => setMaxFileSizeMb(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 25)))}
                  disabled={isReadOnly}
                />

                <TextField
                  label="Định dạng cho phép (cách nhau bởi dấu phẩy)"
                  placeholder="pdf, docx, zip"
                  value={allowedExtsStr}
                  onChange={(e) => setAllowedExtsStr(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
            </section>

            {/* Rubric Builder Section */}
            <section className="form-section-card">
              <div className="rubric-builder-header">
                <div>
                  <h2 className="section-title">Tiêu chí chấm điểm (Rubric)</h2>
                  <p className="section-desc">
                    Thiết lập các tiêu chí cụ thể để chấm điểm minh bạch và chuẩn xác.
                  </p>
                </div>
                <div className="total-score-chip">
                  <span>Tổng điểm: </span>
                  <strong>{totalScore} điểm</strong>
                </div>
              </div>

              {!isAlreadyPublished && !isReadOnly && (
                <div className="rubric-ai-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAiDrawer(true)}
                  >
                    <Sparkles size={16} />
                    <span>Xem mẫu tiêu chí gợi ý chuẩn</span>
                  </Button>
                </div>
              )}

              <div className="rubric-items-stack">
                {rubricItems.map((item, idx) => (
                  <div key={item.id} className="rubric-item-row">
                    <div className="rubric-item-inputs">
                      <div className="input-title-col">
                        <TextField
                          label={`Tiêu chí ${idx + 1}`}
                          value={item.title}
                          onChange={(e) =>
                            handleUpdateCriterion(item.id, { title: e.target.value })
                          }
                          disabled={isAlreadyPublished || isReadOnly}
                        />
                      </div>
                      <div className="input-pts-col">
                        <TextField
                          label="Điểm tối đa"
                          type="number"
                          step="0.5"
                          min="0.1"
                          value={item.maxScore.toString()}
                          onChange={(e) =>
                            handleUpdateCriterion(item.id, {
                              maxScore: parseFloat(e.target.value) || 0,
                            })
                          }
                          disabled={isAlreadyPublished || isReadOnly}
                        />
                      </div>
                      <div className="input-desc-col">
                        <TextField
                          label="Mô tả yêu cầu đạt điểm"
                          value={item.description}
                          onChange={(e) =>
                            handleUpdateCriterion(item.id, { description: e.target.value })
                          }
                          disabled={isAlreadyPublished || isReadOnly}
                        />
                      </div>
                    </div>

                    {!isAlreadyPublished && !isReadOnly && (
                      <div className="rubric-item-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => handleMoveCriterion(idx, 'up')}
                          disabled={idx === 0}
                          title="Di chuyển lên"
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => handleMoveCriterion(idx, 'down')}
                          disabled={idx === rubricItems.length - 1}
                          title="Di chuyển xuống"
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => handleDeleteCriterion(item.id)}
                          title="Xóa tiêu chí này"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {!isAlreadyPublished && !isReadOnly && (
                <div className="add-criterion-row">
                  <Button type="button" variant="ghost" onClick={handleAddCriterion}>
                    <Plus size={16} />
                    <span>+ Thêm tiêu chí đánh giá</span>
                  </Button>
                </div>
              )}
            </section>

            {/* Bottom Actions Bar */}
            {!isReadOnly && (
              <div className="form-bottom-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate(`/gv/mon-hoc/${course.id}/bai-tap`)}
                >
                  Hủy bỏ
                </Button>

                {!isAlreadyPublished ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      isLoading={isSubmitting}
                      disabled={hasPendingFiles}
                      onClick={handleSaveDraft}
                      data-testid="btn-save-draft"
                    >
                      Lưu bản nháp
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      isLoading={isSubmitting}
                      disabled={hasPendingFiles}
                      onClick={() => setShowPublishModal(true)}
                      data-testid="btn-open-publish-modal"
                    >
                      <CheckCircle2 size={16} />
                      <span>Công bố bài tập cho sinh viên</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    isLoading={isSubmitting}
                      disabled={hasPendingFiles}
                    onClick={handleSavePublishedSettings}
                    data-testid="btn-save-published-settings"
                  >
                    <CheckCircle2 size={16} />
                    <span>Lưu cập nhật hạn nộp & thiết lập</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: XEM TRƯỚC NHƯ SINH VIÊN */}
      {activeTab === 'xem-truoc' && (
        <div className="preview-container">
          <div className="preview-watermark-card">
            <span className="preview-badge">
              GIAO DIỆN XEM TRƯỚC (DÀNH CHO GIẢNG VIÊN KIỂM TRA ĐỀ BÀI)
            </span>
            <h2 className="preview-title">{title || 'Tiêu đề bài tập chưa đặt'}</h2>
            <p className="preview-course-meta">
              Học phần: <strong>{course.name}</strong> • Hạn nộp:{' '}
              <strong>
                {dueDateStr} {dueTimeStr}
              </strong>{' '}
              {allowLate && <span className="badge-allow-late">Cho phép nộp muộn</span>}
            </p>

            <hr className="preview-divider" />

            <div className="preview-section">
              <h3>Đề bài & Yêu cầu:</h3>
              <p className="preview-desc-text">
                {description || 'Chưa nhập nội dung hướng dẫn đề bài.'}
              </p>
            </div>

            {attachments.length > 0 && (
              <div className="preview-section">
                <h3>Tài liệu đính kèm ({attachments.length}):</h3>
                <ul className="preview-attachments-list">
                  {attachments.map((att) => (
                    <li key={att.fileId}>
                      <Paperclip size={14} />
                      <span>
                        {att.name} ({formatFileSize(att.sizeBytes)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="preview-section">
              <h3>Chính sách tệp nộp bài:</h3>
              <p className="preview-policy-text">
                Tối đa {maxFiles} tệp mỗi lần nộp • Dung lượng tối đa {maxFileSizeMb} MB/tệp • Định dạng chấp nhận: {allowedExtsStr}
              </p>
            </div>

            <div className="preview-section">
              <h3>Tiêu chí chấm điểm (Rubric) — Tổng {totalScore} điểm:</h3>
              <table className="npc-table">
                <thead>
                  <tr>
                    <th>Tiêu chí</th>
                    <th>Yêu cầu</th>
                    <th>Điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {rubricItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                      </td>
                      <td>{item.description}</td>
                      <td>
                        <strong>{formatScoreVN(item.maxScore)} đ</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Reference Modal (Honest Presentation) */}
      {showAiDrawer && (
        <Modal
          title="Bộ tiêu chí Rubric mẫu tham khảo"
          isOpen={showAiDrawer}
          onClose={() => setShowAiDrawer(false)}
        >
          <div className="ai-drawer-content">
            <div className="alert-notice-box">
              <Sparkles size={18} />
              <span>
                <strong>Ghi chú quy chuẩn:</strong> Tính năng AI sinh đề tự động đang được chuẩn bị cho Milestone B24. Dưới đây là các tiêu chí đánh giá chuẩn học thuật của trường bạn có thể tham khảo hoặc sao chép:
              </span>
            </div>
            <div className="ai-suggested-list">
              <div className="ai-sugg-item">
                <strong>1. Chức năng và đáp ứng yêu cầu nghiệp vụ (4 đ)</strong>
                <p>Thực thi chính xác theo đặc tả kỹ thuật và trường hợp kiểm thử.</p>
              </div>
              <div className="ai-sugg-item">
                <strong>2. Chất lượng kiến trúc và khả năng kiểm thử (3 đ)</strong>
                <p>Mã nguồn rõ ràng, phân tách module, có unit test bao phủ.</p>
              </div>
              <div className="ai-sugg-item">
                <strong>3. Trải nghiệm người dùng và chuẩn tiếp cận WCAG (2 đ)</strong>
                <p>Giao diện tương tác mượt mà, hỗ trợ điều hướng bàn phím đầy đủ.</p>
              </div>
              <div className="ai-sugg-item">
                <strong>4. Báo cáo kỹ thuật và xử lý ngoại lệ (1 đ)</strong>
                <p>Tài liệu hướng dẫn rõ ràng, bắt lỗi và ghi nhận nhật ký an toàn.</p>
              </div>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowAiDrawer(false)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Publish Modal */}
      {showPublishModal && (
        <Modal
          title="Xác nhận công bố bài tập"
          isOpen={showPublishModal}
          onClose={() => setShowPublishModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn chuẩn bị công bố bài tập <strong>"{title}"</strong> cho toàn bộ sinh viên trong lớp học phần.
            </p>
            <div className="publish-summary-card">
              <div>
                Hạn nộp chính thức: <strong>{dueDateStr} lúc {dueTimeStr}</strong>
              </div>
              <div>
                Cho phép nộp muộn: <strong>{allowLate ? 'Có' : 'Không'}</strong>
              </div>
              <div>
                Tổng thang điểm: <strong>{totalScore} điểm</strong> ({rubricItems.length} tiêu chí)
              </div>
              <div>
                Số tệp tài liệu đề: <strong>{attachments.length} tệp đã quét an toàn</strong>
              </div>
            </div>
            <div className="alert-notice-box">
              <AlertTriangle size={18} />
              <span>
                <strong>Quy tắc đóng băng bất biến:</strong> Sau khi công bố, tiêu đề, nội dung yêu cầu, tệp đính kèm và bộ tiêu chí Rubric sẽ được <strong>khóa cố định vĩnh viễn</strong> để đảm bảo sự công bằng cho sinh viên. Giảng viên chỉ được phép điều chỉnh hạn nộp và chính sách nộp bài cho tương lai.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowPublishModal(false)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isSubmitting}
                      disabled={hasPendingFiles}
                onClick={handleConfirmPublish}
                data-testid="confirm-publish-submit-btn"
              >
                Xác nhận công bố bài tập
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
