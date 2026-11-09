import { AssignmentDownloadLog } from '../../learning/AssignmentDownloadLog';
import { useLanguage } from '../../learning/i18n';
import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useOutletContext, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  assignmentsService,
  type AssignmentSummaryItem,
  type AssignmentReopenWindow,
} from '../../../api/assignmentsService';
import { coursesService, type Course, type Chapter, type CourseMember } from '../../../api/coursesService';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { LoadingSkeleton } from '../../../shared/ui/LoadingSkeleton';
import { TextField } from '../../../shared/ui/TextField';
import { formatDateVN } from '../../../shared/kernel/formatting';
import {
  Plus,
  Lock,
  Unlock,
  ArrowRight,
  AlertTriangle,
  Search,
  Settings,
  History,
  Trash2,
} from 'lucide-react';
import './TeacherAssignmentListPage.css';

export const TeacherAssignmentListPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const outletContext = useOutletContext<{ course?: Course; isArchived?: boolean } | null>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notifySuccess, notifyError } = useNotification();
  const navigate = useNavigate();

  const [showDownloadLog, setShowDownloadLog] = useState(false);
  const { t } = useLanguage();

  // Route state
  const activeTab = searchParams.get('tab') || 'all';
  const pageParam = parseInt(searchParams.get('page') || '1', 10);
  const chapterParam = searchParams.get('chapter') || 'all';
  const searchQueryParam = searchParams.get('q') || '';

  // Course state
  const [course, setCourse] = useState<Course | null>(outletContext?.course || null);
  const [courseLoading, setCourseLoading] = useState(!outletContext?.course);
  const isArchived = Boolean(outletContext?.isArchived || course?.status === 'archived');

  // Chapters for filtering
  const [chapters, setChapters] = useState<Chapter[]>([]);

  // Assignments list state
  const [assignments, setAssignments] = useState<AssignmentSummaryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(pageParam > 0 ? pageParam : 1);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Search input local state
  const [searchInput, setSearchInput] = useState(searchQueryParam);

  // Close submission modal
  const [targetToClose, setTargetToClose] = useState<AssignmentSummaryItem | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  // Reopen Windows management modal
  const [targetForReopen, setTargetForReopen] = useState<AssignmentSummaryItem | null>(null);
  const [reopenWindows, setReopenWindows] = useState<AssignmentReopenWindow[]>([]);
  const [reopenWindowsLoading, setReopenWindowsLoading] = useState(false);
  const [isCreatingWindow, setIsCreatingWindow] = useState(false);
  const [windowTargetType, setWindowTargetType] = useState<'all' | 'student'>('all');
  const [windowStudentId, setWindowStudentId] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [windowMembers, setWindowMembers] = useState<CourseMember[]>([]);
  const [memberSearchError, setMemberSearchError] = useState('');
  const [windowScope, setWindowScope] = useState<'all_actions' | 'first_only'>('all_actions');
  const [windowEndDate, setWindowEndDate] = useState('');
  const [windowEndTime, setWindowEndTime] = useState('23:59');
  const [windowReason, setWindowReason] = useState('');

  useEffect(() => {
    if (!monId || !targetForReopen || windowTargetType !== 'student') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void coursesService.getCourseMembers(monId, { search: studentSearch, status: 'active', page_size: 100 })
        .then(data => { if (!cancelled) { setWindowMembers(data.items); setMemberSearchError(''); } })
        .catch(() => { if (!cancelled) setMemberSearchError(uiText("Không thể tải danh sách sinh viên. Hãy thử tìm lại.")); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [monId, targetForReopen, windowTargetType, studentSearch]);

  // Race condition guard
  const loadSequence = useRef(0);

  // Fetch course if not in outlet
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

  // Fetch chapters for filter dropdown
  useEffect(() => {
    if (!monId) return;
    let isMounted = true;
    coursesService
      .listChapters(monId)
      .then((ch) => {
        if (isMounted) setChapters(ch);
      })
      .catch(() => {
        // Silently handle chapter load failure
      });

    return () => {
      isMounted = false;
    };
  }, [monId]);

  // Fetch assignments list
  const loadAssignments = useCallback(async () => {
    if (!monId) return;
    const seq = ++loadSequence.current;
    setIsLoading(true);
    setFetchError(null);

    try {
      const statusFilter =
        activeTab === 'all'
          ? undefined
          : activeTab === 'closed'
            ? 'closed'
            : activeTab;

      const chapterFilter = chapterParam === 'all' ? undefined : chapterParam;

      const res = await assignmentsService.listTeacherAssignments(monId, {
        status: statusFilter,
        chapter_id: chapterFilter,
        search: searchQueryParam || undefined,
        page: currentPage,
        page_size: 10,
      });

      if (seq !== loadSequence.current) return;

      setAssignments(res.items);
      setTotalCount(res.pagination.total_items);
      setTotalPages(res.pagination.total_pages);
    } catch (err) {
      if (seq !== loadSequence.current) return;
      setFetchError(err instanceof Error ? err.message : uiText("Không thể tải danh sách bài tập."));
      setAssignments([]);
    } finally {
      if (seq === loadSequence.current) {
        setIsLoading(false);
      }
    }
  }, [monId, activeTab, chapterParam, searchQueryParam, currentPage]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  // Tab selection handler
  const handleSelectTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'all') next.delete('tab');
    else next.set('tab', tab);
    next.delete('page');
    setCurrentPage(1);
    setSearchParams(next);
  };

  // Chapter filter handler
  const handleSelectChapter = (chapterId: string) => {
    const next = new URLSearchParams(searchParams);
    if (chapterId === 'all') next.delete('chapter');
    else next.set('chapter', chapterId);
    next.delete('page');
    setCurrentPage(1);
    setSearchParams(next);
  };

  // Search handler
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    const trimmed = searchInput.trim();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    next.delete('page');
    setCurrentPage(1);
    setSearchParams(next);
  };

  // Pagination navigation
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
    const next = new URLSearchParams(searchParams);
    next.set('page', String(newPage));
    setSearchParams(next);
  };

  // Close assignment
  const handleConfirmClose = async () => {
    if (!monId || !targetToClose) return;
    setIsClosing(true);
    try {
      await assignmentsService.closeAssignment(monId, targetToClose.id, {
        close_type: 'manual_close',
        reason: closeReason.trim() || uiText("Giảng viên chủ động đóng nhận bài"),
        target_type: 'all',
        scope: 'all_actions',
      });
      notifySuccess(uiText("Đã đóng nhận bài cho bài tập \"{0}\".",[targetToClose.title]));
      setTargetToClose(null);
      setCloseReason('');
      void loadAssignments();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Lỗi khi đóng nhận bài tập."));
    } finally {
      setIsClosing(false);
    }
  };

  // Quick Reopen
  const handleQuickReopen = async (ass: AssignmentSummaryItem) => {
    if (!monId) return;
    try {
      await assignmentsService.reopenAssignment(monId, ass.id, {
        close_type: 'reopen',
        reason: uiText("Giảng viên mở lại toàn thể"),
        target_type: 'all',
        scope: 'all_actions',
      });
      notifySuccess(uiText("Đã mở lại cổng nhận bài cho bài tập \"{0}\".",[ass.title]));
      void loadAssignments();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Lỗi khi mở lại bài tập."));
    }
  };

  // Open Reopen Windows Modal
  const handleOpenReopenWindows = async (ass: AssignmentSummaryItem) => {
    if (!monId) return;
    setTargetForReopen(ass);
    setReopenWindowsLoading(true);

    // Default window end time to tomorrow at 23:59
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setWindowEndDate(tomorrow.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }));
    setWindowEndTime('23:59');
    setWindowReason('');
    setWindowTargetType('all');
    setWindowStudentId('');
    setWindowScope('all_actions');

    try {
      const windows = await assignmentsService.listReopenWindows(monId, ass.id);
      setReopenWindows(windows);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Không thể tải danh sách cửa sổ mở lại."));
      setReopenWindows([]);
    } finally {
      setReopenWindowsLoading(false);
    }
  };

  // Create Reopen Window
  const handleCreateReopenWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monId || !targetForReopen) return;

    if (!windowEndDate) {
      notifyError(uiText("Vui lòng chọn ngày kết thúc cửa sổ mở lại."));
      return;
    }

    if (windowTargetType === 'student' && !windowStudentId.trim()) {
      notifyError(uiText("Vui lòng nhập mã sinh viên được cấp quyền nộp lại."));
      return;
    }

    setIsCreatingWindow(true);
    try {
      const endAtIso = `${windowEndDate}T${windowEndTime}:00+07:00`;
      await assignmentsService.createReopenWindow(monId, targetForReopen.id, {
        target_type: windowTargetType,
        student_id: windowTargetType === 'student' ? windowStudentId.trim() : null,
        scope: windowScope,
        end_at: endAtIso,
        reason: windowReason.trim() || uiText("Giảng viên cấp cửa sổ nộp bài ngoại lệ"),
      });

      notifySuccess(uiText("Đã tạo cửa sổ mở lại thành công."));
      // Refresh windows list
      const updated = await assignmentsService.listReopenWindows(monId, targetForReopen.id);
      setReopenWindows(updated);
      setWindowReason('');
      void loadAssignments();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Lỗi tạo cửa sổ mở lại."));
    } finally {
      setIsCreatingWindow(false);
    }
  };

  // Revoke Reopen Window
  const handleRevokeWindow = async (windowId: string) => {
    if (!monId || !targetForReopen) return;
    try {
      await assignmentsService.revokeReopenWindow(monId, targetForReopen.id, windowId);
      notifySuccess(uiText("Đã hủy bỏ cửa sổ mở lại."));
      const updated = await assignmentsService.listReopenWindows(monId, targetForReopen.id);
      setReopenWindows(updated);
      void loadAssignments();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : uiText("Lỗi hủy cửa sổ mở lại."));
    }
  };

  if (courseLoading) {
    return (
      <div className="teacher-ass-container">
        <LoadingSkeleton />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="teacher-ass-container">
        <EmptyState
          title={uiText("Không tìm thấy môn học")}
          description={uiText("Môn học không tồn tại trên hệ thống hoặc bạn không có quyền truy cập.")}
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              {uiText("Về danh sách môn học")}</Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="teacher-assignment-list-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: uiText("Bàn làm việc"), path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: uiText("Quản lý bài tập") },
            ]}
          />
          <h1 className="page-main-heading">{uiText("Bài tập & Đề thi học phần")}</h1>
<Button type="button" variant="secondary" aria-expanded={showDownloadLog} aria-controls="assignment-download-log" onClick={() => setShowDownloadLog(value => !value)}>
            <History size={16} />{t('Xem log tải tài liệu', 'View download log')}
          </Button>
          <p className="page-subtitle">
            {uiText("Thiết lập đề bài, tiêu chí rubric chấm điểm và quản lý tiến độ nộp bài của sinh viên.")}</p>
        </div>

        {!isArchived && (
          <Link
            to={`/gv/mon-hoc/${course.id}/bai-tap/soan`}
            className="npc-btn npc-btn-primary"
            data-testid="btn-create-assignment"
          >
            <Plus size={18} />
            <span>{uiText("Soạn bài tập mới")}</span>
          </Link>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            {uiText("Môn học đã lưu trữ: Toàn bộ bài tập ở trạng thái chỉ đọc. Không thể soạn bài mới hoặc điều chỉnh tiêu chí.")}</span>
        </div>
      )}

      {showDownloadLog && <AssignmentDownloadLog key={course.id} courseId={course.id} />}

      {/* Filter and Search Bar */}
      <div className="ass-filter-bar">
        <form onSubmit={handleSearchSubmit} className="search-form-wrap">
          <div className="search-input-group">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder={uiText("Tìm kiếm theo tiêu đề bài tập...")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label={uiText("Tìm kiếm bài tập")}
            />
            {searchInput && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => {
                  setSearchInput('');
                  const next = new URLSearchParams(searchParams);
                  next.delete('q');
                  setSearchParams(next);
                }}
              >
                {uiText("×")}</button>
            )}
          </div>
          <Button type="submit" variant="secondary" className="search-btn">
            {uiText("Tìm")}</Button>
        </form>

        {chapters.length > 0 && (
          <div className="chapter-filter-wrap">
            <label htmlFor="chapter-select" className="filter-label">
              {uiText("Chương:")}</label>
            <select
              id="chapter-select"
              className="chapter-select"
              value={chapterParam}
              onChange={(e) => handleSelectChapter(e.target.value)}
            >
              <option value="all">{uiText("Tất cả các chương")}</option>
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Status Tabs */}
      <div className="ass-tabs-bar" role="tablist">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => handleSelectTab('all')}
          role="tab"
          aria-selected={activeTab === 'all'}
        >
          <span>{uiText("Tất cả")}</span>
          {activeTab === 'all' && <span className="count-chip">{totalCount}</span>}
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'published' ? 'active' : ''}`}
          onClick={() => handleSelectTab('published')}
          role="tab"
          aria-selected={activeTab === 'published'}
        >
          <span>{uiText("Đang mở")}</span>
          {activeTab === 'published' && <span className="count-chip">{totalCount}</span>}
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'draft' ? 'active' : ''}`}
          onClick={() => handleSelectTab('draft')}
          role="tab"
          aria-selected={activeTab === 'draft'}
        >
          <span>{uiText("Bản nháp")}</span>
          {activeTab === 'draft' && <span className="count-chip">{totalCount}</span>}
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'closed' ? 'active' : ''}`}
          onClick={() => handleSelectTab('closed')}
          role="tab"
          aria-selected={activeTab === 'closed'}
        >
          <span>{uiText("Đã đóng nộp")}</span>
          {activeTab === 'closed' && <span className="count-chip">{totalCount}</span>}
        </button>
      </div>

      {/* Content Area */}
      {fetchError && (
        <ErrorBanner
          message={fetchError}
          onRetry={() => void loadAssignments()}
        />
      )}

      {isLoading ? (
        <div className="ass-table-wrapper loading-state">
          <LoadingSkeleton />
        </div>
      ) : assignments.length === 0 ? (
        <EmptyState
          title={uiText("Chưa có bài tập")}
          description={
            searchQueryParam
              ? uiText("Không tìm thấy bài tập nào phù hợp với từ khóa \"{0}\".",[searchQueryParam])
              : activeTab === 'draft'
                ? uiText("Không có bài tập nào ở trạng thái bản nháp.")
                : activeTab === 'published'
                  ? uiText("Chưa có bài tập nào đang mở thu nhận bài.")
                  : activeTab === 'closed'
                    ? uiText("Chưa có bài tập nào bị đóng cổng nhận bài.")
                    : uiText("Môn học này hiện chưa có bài tập nào được tạo.")
          }
          action={
            !isArchived ? (
              <Button
                variant="primary"
                onClick={() => navigate(`/gv/mon-hoc/${course.id}/bai-tap/soan`)}
              >
                {uiText("Soạn bài tập đầu tiên")}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="ass-table-wrapper">
          <table className="npc-table" data-testid="teacher-assignments-table">
            <thead>
              <tr>
                <th>{uiText("Tiêu đề bài tập")}</th>
                <th>{uiText("Hạn nộp")}</th>
                <th>{uiText("Nộp muộn")}</th>
                <th>{uiText("Đã nộp")}</th>
                <th>{uiText("Tiến độ công bố điểm")}</th>
                <th>{uiText("Trạng thái")}</th>
                <th>{uiText("Thao tác")}</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((ass) => {
                const isDraft = ass.status === 'draft';
                const isPublished = ass.status === 'published';
                const isClosed = ass.status === 'closed';
                const isItemArchived = ass.status === 'archived';

                return (
                  <tr key={ass.id} data-testid={`assignment-row-${ass.id}`}>
                    <td>
                      <Link
                        to={
                          isDraft
                            ? `/gv/mon-hoc/${course.id}/bai-tap/soan?baiTap=${ass.id}`
                            : `/gv/bai-tap/${ass.id}/bai-nop`
                        }
                        className="ass-title-link"
                      >
                        <strong>{ass.title}</strong>
                      </Link>
                      <div className="ass-subtext">
                        {uiText("Thang điểm: ")}{ass.total_score} {uiText(" đ (")}{ass.rubric_count} {uiText(" tiêu chí")}{ass.attachment_count > 0 ? uiText(" • {0} tệp đính kèm",[ass.attachment_count]) : ''})
                      </div>
                    </td>
                    <td>{formatDateVN(ass.due_at)}</td>
                    <td>
                      {ass.allow_late ? (
                        <span className="badge-allow-late">{uiText("Cho phép")}</span>
                      ) : (
                        <span className="text-muted">{uiText("Khóa")}</span>
                      )}
                    </td>
                    <td>
                      <span className="metric-count">{ass.submission_count} {uiText(" bài")}</span>
                    </td>
                    <td>
                      {ass.submission_count > 0 ? (
                        <div className="assignment-grade-progress">
                          <span>
                            {ass.graded_count}/{ass.submission_count} {uiText(" đã công bố")}</span>
                          
                          <progress
                          aria-label={uiText("Tiến độ công bố điểm: {0}",[ass.title])}
                          value={ass.graded_count}
                          max={ass.submission_count}
                          />
                          
                          <small>
                            {ass.graded_count === ass.submission_count
                            ? uiText("Đã công bố đủ")
                            : uiText("{0} chờ công bố",[ass.submission_count - ass.graded_count])}
                            </small>
                            </div>
                            ) : (
                            <span className="text-muted">{uiText("Chưa có bài nộp")}</span>
                            )}
                    </td>
                    <td>
                      <Badge
                        variant={
                          isPublished
                            ? 'published'
                            : isClosed
                              ? 'closed'
                              : isItemArchived
                                ? 'archived'
                                : 'draft'
                        }
                        label={
                          isPublished
                            ? uiText("Đang mở")
                            : isClosed
                              ? uiText("Đã đóng nộp")
                              : isItemArchived
                                ? uiText("Đã lưu trữ")
                                : uiText("Bản nháp")
                        }
                      />
                    </td>
                    <td>
                      <div className="ass-row-actions">
                        {isDraft && (
                          <Link
                            to={`/gv/mon-hoc/${course.id}/bai-tap/soan?baiTap=${ass.id}`}
                            className="npc-btn npc-btn-secondary npc-btn-sm"
                            data-testid={`btn-edit-${ass.id}`}
                          >
                            {uiText("Tiếp tục soạn")}</Link>
                        )}

                        {isPublished && (
                          <>
                            <Link
                              to={`/gv/bai-tap/${ass.id}/bai-nop`}
                              className="npc-btn npc-btn-primary npc-btn-sm"
                            >
                              <span>{uiText("Bài nộp (")}{ass.submission_count})</span>
                              <ArrowRight size={14} />
                            </Link>

                            {!isArchived && (
                              <>
                                <Link
                                  to={`/gv/mon-hoc/${course.id}/bai-tap/soan?baiTap=${ass.id}`}
                                  className="npc-btn npc-btn-secondary npc-btn-sm"
                                  title={uiText("Chỉnh sửa hạn nộp & thiết lập")}
                                >
                                  <Settings size={14} />
                                </Link>

                                <button
                                  type="button"
                                  className="npc-btn npc-btn-ghost npc-btn-sm text-warning"
                                  onClick={() => setTargetToClose(ass)}
                                  title={uiText("Đóng cổng nhận bài nộp")}
                                  data-testid={`btn-close-${ass.id}`}
                                >
                                  <Lock size={14} />
                                  <span>{uiText("Đóng nộp")}</span>
                                </button>
                                <button
                                  type="button"
                                  className="npc-btn npc-btn-ghost npc-btn-sm"
                                  onClick={() => handleOpenReopenWindows(ass)}
                                  title={uiText("Quản lý cửa sổ mở lại ngoại lệ")}
                                  data-testid={`btn-reopen-windows-${ass.id}`}
                                >
                                  <History size={14} />
                                  <span>{uiText("Cửa sổ nộp lại")}</span>
                                </button>
                              </>
                            )}
                          </>
                        )}

                        {isClosed && (
                          <>
                            <Link
                              to={`/gv/bai-tap/${ass.id}/bai-nop`}
                              className="npc-btn npc-btn-secondary npc-btn-sm"
                            >
                              {uiText("Xem bài nộp")}</Link>

                            {!isArchived && (
                              <>
                                <button
                                  type="button"
                                  className="npc-btn npc-btn-ghost npc-btn-sm"
                                  onClick={() => handleQuickReopen(ass)}
                                  title={uiText("Mở lại cổng nhận bài cho cả lớp")}
                                  data-testid={`btn-quick-reopen-${ass.id}`}
                                >
                                  <Unlock size={14} />
                                  <span>{uiText("Mở lại")}</span>
                                </button>

                                <button
                                  type="button"
                                  className="npc-btn npc-btn-ghost npc-btn-sm"
                                  onClick={() => handleOpenReopenWindows(ass)}
                                  title={uiText("Quản lý cửa sổ mở lại ngoại lệ")}
                                  data-testid={`btn-reopen-windows-${ass.id}`}
                                >
                                  <History size={14} />
                                  <span>{uiText("Cửa sổ nộp lại")}</span>
                                </button>
                              </>
                            )}
                          </>
                        )}

                        {isItemArchived && (
                          <Link
                            to={`/gv/bai-tap/${ass.id}/bai-nop`}
                            className="npc-btn npc-btn-secondary npc-btn-sm"
                          >
                            {uiText("Xem bài nộp")}</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="pagination-controls-bar">
              <span className="pagination-meta">
                Trang {currentPage} / {totalPages} {uiText(" (Tổng số ")}{totalCount} {uiText(" bài tập)")}</span>
              <div className="pagination-buttons">
                <Button
                  variant="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => handlePageChange(currentPage - 1)}
                >
                  {uiText("Trang trước")}</Button>
                <Button
                  variant="secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  {uiText("Trang kế")}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Confirm Manual Close */}
      {targetToClose && (
        <Modal
          title={uiText("Xác nhận đóng cổng nhận bài nộp")}
          isOpen={!!targetToClose}
          onClose={() => setTargetToClose(null)}
        >
          <div className="modal-content-stack">
            <p>
              {uiText("Bạn có chắc chắn muốn đóng cổng nộp bài cho bài tập")}{' '}
              <strong>"{targetToClose.title}"</strong>?
            </p>
            <TextField
              label={uiText("Lý do đóng nhận bài (Ghi nhận nhật ký kiểm toán)")}
              placeholder={uiText("Ví dụ: Hết thời gian làm bài kiểm tra trên lớp...")}
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
            />
            <div className="alert-notice-box">
              <AlertTriangle size={18} />
              <span>
                {uiText("Sau khi đóng, sinh viên không thể nộp bài. Giảng viên cần mở lại bài tập trước khi áp dụng cửa sổ ngoại lệ.")}</span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setTargetToClose(null)}>
                {uiText("Hủy bỏ")}</Button>
              <Button
                type="button"
                variant="danger"
                isLoading={isClosing}
                onClick={handleConfirmClose}
                data-testid="confirm-close-btn"
              >
                {uiText("Xác nhận đóng nộp bài")}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Reopen Windows Management */}
      {targetForReopen && (
        <Modal
          title={uiText("Quản lý cửa sổ mở lại: \"{0}\"",[targetForReopen.title])}
          isOpen={!!targetForReopen}
          onClose={() => setTargetForReopen(null)}
        >
          <div className="modal-content-stack">
            <section className="reopen-form-section">
              <h3 className="sub-modal-title">{uiText("Cấp cửa sổ mở lại mới")}</h3>
              <form onSubmit={handleCreateReopenWindow} className="reopen-form">
                <div className="form-row-compact">
                  <div className="form-group-item">
                    <label className="field-label" htmlFor="reopen-target">{uiText("Đối tượng:")}</label>
                    <select
                      id="reopen-target"
                      className="field-select"
                      value={windowTargetType}
                      onChange={(e) => setWindowTargetType(e.target.value as 'all' | 'student')}
                    >
                      <option value="all">{uiText("Toàn bộ sinh viên lớp học phần")}</option>
                      <option value="student">{uiText("Chỉ định sinh viên cụ thể")}</option>
                    </select>
                  </div>

                  {windowTargetType === 'student' && (
                    <div className="form-group-item">
                        <TextField label={uiText("Tìm sinh viên theo tên hoặc email")} value={studentSearch} onChange={e => { setStudentSearch(e.target.value); setWindowStudentId(''); }} />
                        <label htmlFor="reopen-student">{uiText("Sinh viên được mở lại")}</label>
                        <select id="reopen-student" className="field-select" required value={windowStudentId} onChange={e => setWindowStudentId(e.target.value)}>
                          <option value="">{uiText("Chọn sinh viên đang ghi danh")}</option>
                          {windowMembers.map(member => <option key={member.student_id} value={member.student_id}>{member.student_name} — {member.student_email}</option>)}
                        </select>
                        <small>{uiText("Hiển thị tối đa 100 kết quả. Tìm theo email để thu hẹp danh sách.")}</small>
                        {memberSearchError && <p role="alert">{memberSearchError}</p>}
                    </div>
                  )}
                </div>

                <div className="form-row-compact">
                  <div className="form-group-item">
                    <label className="field-label">{uiText("Phạm vi thao tác:")}</label>
                    <select
                      className="field-select"
                      value={windowScope}
                      onChange={(e) => setWindowScope(e.target.value as 'all_actions' | 'first_only')}
                    >
                      <option value="all_actions">{uiText("Nộp mới và nộp thay thế bài cũ")}</option>
                      <option value="first_only">{uiText("Chỉ cho phép nộp lần đầu")}</option>
                    </select>
                  </div>

                  <div className="form-group-item">
                    <TextField
                      label={uiText("Thời hạn kết thúc cửa sổ (Ngày)")}
                      type="date"
                      required
                      value={windowEndDate}
                      onChange={(e) => setWindowEndDate(e.target.value)}
                    />
                  </div>

                  <div className="form-group-item">
                    <TextField
                      label={uiText("Giờ kết thúc")}
                      type="time"
                      required
                      value={windowEndTime}
                      onChange={(e) => setWindowEndTime(e.target.value)}
                    />
                  </div>
                </div>

                <TextField
                  label={uiText("Lý do mở lại (Audit log)")}
                  placeholder={uiText("Ví dụ: Sinh viên có lý do y tế có đơn phê duyệt...")}
                  value={windowReason}
                  onChange={(e) => setWindowReason(e.target.value)}
                />

                <div className="reopen-submit-bar">
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={isCreatingWindow}
                    data-testid="btn-submit-reopen-window"
                  >
                    {uiText("Tạo cửa sổ mở lại")}</Button>
                </div>
              </form>
            </section>

            <hr className="divider-soft" />

            <section className="reopen-list-section">
              <h3 className="sub-modal-title">{uiText("Danh sách cửa sổ đã cấp")}</h3>
              {reopenWindowsLoading ? (
                <LoadingSkeleton />
              ) : reopenWindows.length === 0 ? (
                <p className="text-muted">{uiText("Chưa có cửa sổ mở lại nào được ghi nhận cho bài tập này.")}</p>
              ) : (
                <div className="reopen-table-wrap">
                  <table className="npc-table compact-table">
                    <thead>
                      <tr>
                        <th>{uiText("Đối tượng")}</th>
                        <th>{uiText("Phạm vi")}</th>
                        <th>{uiText("Hết hạn")}</th>
                        <th>{uiText("Trạng thái")}</th>
                        <th>{uiText("Thao tác")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reopenWindows.map((win) => (
                        <tr key={win.id}>
                          <td>{win.target_type === 'all' ? uiText("Cả lớp") : `SV: ${win.student_id?.slice(0, 8)}...`}</td>
                          <td>{win.scope === 'all_actions' ? uiText("Mọi thao tác") : uiText("Chỉ nộp đầu")}</td>
                          <td>{formatDateVN(win.end_at)}</td>
                          <td>
                            {win.is_active ? (
                              <span className="badge-active-window">{uiText("Đang mở")}</span>
                            ) : (
                              <span className="text-muted">{uiText("Đã đóng/hủy")}</span>
                            )}
                          </td>
                          <td>
                            {win.is_active && (
                              <button
                                type="button"
                                className="npc-btn npc-btn-ghost npc-btn-sm text-danger"
                                onClick={() => handleRevokeWindow(win.id)}
                                title={uiText("Hủy bỏ cửa sổ này")}
                              >
                                <Trash2 size={14} />
                                <span>{uiText("Hủy")}</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setTargetForReopen(null)}>
                {uiText("Đóng")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
