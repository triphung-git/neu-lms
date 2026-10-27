import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  coursesService,
  Course,
  CourseMember,
  TeacherEnrollmentRequest,
} from '../../../api/coursesService';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField, TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import {
  UserPlus,
  UserMinus,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Unlock,
  Lock,
  Users,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import './CourseMembersPage.css';

export const CourseMembersPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const navigate = useNavigate();
  const { notifySuccess, notifyError } = useNotification();

  // Course state
  const [course, setCourse] = useState<Course | null>(null);
  const [courseLoading, setCourseLoading] = useState(true);
  const [courseForbidden, setCourseForbidden] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);

  // Tabs state: 'members' | 'requests'
  const [activeTab, setActiveTab] = useState<'members' | 'requests'>('members');

  // Members state
  const [membersPage, setMembersPage] = useState(1);
  const [membersTotalPages, setMembersTotalPages] = useState(1);
  const [membersTotalItems, setMembersTotalItems] = useState(0);
  const [members, setMembers] = useState<CourseMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersFilter, setMembersFilter] = useState<'all' | 'active' | 'withdrawn'>('all');
  const [membersSearch, setMembersSearch] = useState('');

  // Requests state
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsTotalPages, setRequestsTotalPages] = useState(1);
  const [requestsTotalItems, setRequestsTotalItems] = useState(0);
  const [requests, setRequests] = useState<TeacherEnrollmentRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestsFilter, setRequestsFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('all');
  const [requestsSearch, setRequestsSearch] = useState('');

  // Action guards
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Single Add Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Withdraw confirm modal
  const [withdrawTarget, setWithdrawTarget] = useState<CourseMember | null>(null);
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  // Reject confirm modal
  const [rejectTarget, setRejectTarget] = useState<TeacherEnrollmentRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  // Sequence refs to discard stale responses
  const courseSeqRef = useRef(0);
  const membersSeqRef = useRef(0);
  const requestsSeqRef = useRef(0);

  // 1. Fetch course details
  const fetchCourse = useCallback(async () => {
    if (!monId) return;
    const seq = ++courseSeqRef.current;
    setCourseLoading(true);
    setCourseForbidden(false);
    setCourseError(null);

    try {
      const data = await coursesService.get(monId);
      if (seq === courseSeqRef.current) {
        setCourse(data);
      }
    } catch (err: any) {
      if (seq === courseSeqRef.current) {
        if (err.status === 403) {
          setCourseForbidden(true);
        } else if (err.status === 404) {
          setCourse(null);
        } else {
          setCourseError(err.message || 'Không thể tải thông tin môn học.');
        }
      }
    } finally {
      if (seq === courseSeqRef.current) {
        setCourseLoading(false);
      }
    }
  }, [monId]);

  useEffect(() => {
    void fetchCourse();
    return () => { courseSeqRef.current += 1; membersSeqRef.current += 1; requestsSeqRef.current += 1; };
  }, [fetchCourse]);

  // 2. Fetch members
  const fetchMembers = useCallback(async () => {
    if (!course) return;
    const seq = ++membersSeqRef.current;
    setMembersLoading(true);
    setMembersError(null);

    try {
      const params = { status: membersFilter !== 'all' ? membersFilter : undefined, search: membersSearch.trim() || undefined, page: membersPage, page_size: 20 };
      const res = await coursesService.getCourseMembers(course.id, params);
      if (seq === membersSeqRef.current) {
        setMembers(res.items || []);
        setMembersTotalPages(res.pagination.total_pages);
        setMembersTotalItems(res.pagination.total_items);
      }
    } catch (err: any) {
      if (seq === membersSeqRef.current) {
        setMembersError(err.message || 'Không thể tải danh sách thành viên.');
      }
    } finally {
      if (seq === membersSeqRef.current) {
        setMembersLoading(false);
      }
    }
  }, [course, membersFilter, membersSearch, membersPage]);

  // 3. Fetch enrollment requests
  const fetchRequests = useCallback(async () => {
    if (!course) return;
    const seq = ++requestsSeqRef.current;
    setRequestsLoading(true);
    setRequestsError(null);

    try {
      const params = { status: requestsFilter !== 'all' ? requestsFilter : undefined, search: requestsSearch.trim() || undefined, page: requestsPage, page_size: 20 };
      const res = await coursesService.getCourseEnrollmentRequests(course.id, params);
      if (seq === requestsSeqRef.current) {
        setRequests(res.items || []);
        setRequestsTotalPages(res.pagination.total_pages);
        setRequestsTotalItems(res.pagination.total_items);
      }
    } catch (err: any) {
      if (seq === requestsSeqRef.current) {
        setRequestsError(err.message || 'Không thể tải hàng đợi ghi danh.');
      }
    } finally {
      if (seq === requestsSeqRef.current) {
        setRequestsLoading(false);
      }
    }
  }, [course, requestsFilter, requestsSearch, requestsPage]);

  useEffect(() => {
    if (course && !courseForbidden) {
      if (activeTab === 'members') {
        fetchMembers();
      } else {
        fetchRequests();
      }
    }
    return () => { membersSeqRef.current += 1; requestsSeqRef.current += 1; };
  }, [course, courseForbidden, activeTab, fetchMembers, fetchRequests]);

  const isArchived = course?.status === 'archived';

  // Toggle Admission Handler
  const handleToggleAdmission = async () => {
    if (!course || isArchived || toggleLoading) return;
    setToggleLoading(true);
    try {
      const updated = await coursesService.update(course.id, {
        enrollment_open: !course.enrollment_open,
      });
      setCourse(updated);
      notifySuccess(
        updated.enrollment_open
          ? 'Đã mở nhận ghi danh học phần.'
          : 'Đã đóng nhận ghi danh học phần.'
      );
    } catch (err: any) {
      notifyError(err.data?.detail || err.message || 'Không thể cập nhật trạng thái nhận ghi danh.');
    } finally {
      setToggleLoading(false);
    }
  };

  // Add Member Handler
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course || isArchived || addLoading) return;
    const emailTrimmed = addEmail.trim().toLowerCase();
    if (!emailTrimmed) {
      notifyError('Vui lòng nhập địa chỉ email sinh viên.');
      return;
    }

    setAddLoading(true);
    try {
      const newMember = await coursesService.addCourseMember(course.id, emailTrimmed);
      notifySuccess(`Đã ghi danh thành công sinh viên ${newMember.student_name || newMember.student_email} vào lớp.`);
      setShowAddModal(false);
      setAddEmail('');
      fetchMembers();
    } catch (err: any) {
      const errMsg =
        err.data?.student_email?.[0] ||
        err.data?.detail ||
        err.data?.message ||
        err.message ||
        'Không thể thêm sinh viên vào lớp.';
      notifyError(errMsg);
    } finally {
      setAddLoading(false);
    }
  };

  // Confirm Withdraw Member Handler
  const handleConfirmWithdraw = async () => {
    if (!course || !withdrawTarget || isArchived || withdrawLoading) return;
    setWithdrawLoading(true);
    try {
      await coursesService.withdrawMember(course.id, withdrawTarget.student_id);
      notifySuccess(`Đã chuyển sinh viên ${withdrawTarget.student_name || withdrawTarget.student_email} sang trạng thái Đã rút.`);
      setWithdrawTarget(null);
      fetchMembers();
    } catch (err: any) {
      notifyError(err.data?.detail || err.message || 'Không thể rút sinh viên khỏi lớp.');
    } finally {
      setWithdrawLoading(false);
    }
  };

  // Restore Member Handler
  const handleRestoreMember = async (member: CourseMember) => {
    if (!course || isArchived || actionLoading[member.id]) return;
    setActionLoading((prev) => ({ ...prev, [member.id]: true }));
    try {
      await coursesService.reEnrollMember(course.id, member.student_id);
      notifySuccess(`Đã khôi phục trạng thái Đang học cho ${member.student_name || member.student_email}.`);
      fetchMembers();
    } catch (err: any) {
      notifyError(err.data?.detail || err.message || 'Không thể khôi phục sinh viên.');
    } finally {
      setActionLoading((prev) => ({ ...prev, [member.id]: false }));
    }
  };

  // Approve Request Handler
  const handleApproveRequest = async (req: TeacherEnrollmentRequest) => {
    if (!course || isArchived || actionLoading[req.id]) return;
    setActionLoading((prev) => ({ ...prev, [req.id]: true }));
    try {
      await coursesService.approveEnrollmentRequest(req.id);
      notifySuccess(`Đã duyệt yêu cầu ghi danh của ${req.student_name || req.student_email}.`);
      fetchRequests();
    } catch (err: any) {
      notifyError(err.data?.detail || err.message || 'Không thể duyệt yêu cầu ghi danh.');
    } finally {
      setActionLoading((prev) => ({ ...prev, [req.id]: false }));
    }
  };

  // Confirm Reject Request Handler
  const handleConfirmReject = async () => {
    if (!rejectTarget || isArchived || rejectLoading) return;
    setRejectLoading(true);
    try {
      await coursesService.rejectEnrollmentRequest(rejectTarget.id, rejectReason.trim());
      notifySuccess(`Đã từ chối yêu cầu của ${rejectTarget.student_name || rejectTarget.student_email}.`);
      setRejectTarget(null);
      setRejectReason('');
      fetchRequests();
    } catch (err: any) {
      notifyError(err.data?.detail || err.message || 'Không thể từ chối yêu cầu.');
    } finally {
      setRejectLoading(false);
    }
  };

  // Search and pagination are performed by the server across all rows.
  const filteredMembers = members;
  const filteredRequests = requests;

  // Loading State
  if (courseLoading) {
    return (
      <div className="course-members-container" aria-busy="true">
        <p className="text-muted">Đang tải thông tin học phần và thành viên...</p>
      </div>
    );
  }

  // Forbidden State
  if (courseForbidden) {
    return (
      <div className="course-members-container">
        <EmptyState
          icon={<ShieldAlert size={48} className="icon-danger" />}
          title="Không có quyền truy cập"
          description="Bạn không có quyền quản lý thành viên của môn học này. Chỉ giảng viên phụ trách môn học mới có quyền truy cập."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv')}>
              Quay lại Bàn làm việc
            </Button>
          }
        />
      </div>
    );
  }

  if (courseError) return <ErrorBanner message={courseError} onRetry={() => void fetchCourse()} />;

  // Not Found State
  if (!course) {
    return (
      <div className="course-members-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description={courseError || 'Môn học không tồn tại trên hệ thống.'}
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="course-members-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Thành viên lớp học' },
            ]}
          />
          <h1 className="page-main-heading">Quản lý thành viên & Ghi danh</h1>
          <p className="page-subtitle">
            Học phần: <strong>{course.name} ({course.code})</strong> — Học kỳ: {course.term}
          </p>
        </div>

        {!isArchived && (
          <div className="header-actions">
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowAddModal(true)}
            >
              <UserPlus size={16} />
              <span>Thêm sinh viên</span>
            </Button>
          </div>
        )}
      </div>

      {/* Archived Warning Alert */}
      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Toàn bộ danh sách thành viên và hàng đợi ghi danh ở chế độ chỉ đọc. Không thể thêm mới, duyệt yêu cầu hoặc rút sinh viên.
          </span>
        </div>
      )}

      {/* Admission Status Box */}
      <div className="admission-toggle-card">
        <div className="admission-info">
          <div className={`admission-icon-wrap ${course.enrollment_open ? 'open' : 'closed'}`}>
            {course.enrollment_open ? <Unlock size={20} /> : <Lock size={20} />}
          </div>
          <div>
            <h2 className="admission-title">
              Cổng nhận ghi danh:{' '}
              <Badge
                variant={course.enrollment_open ? 'published' : 'archived'}
                label={course.enrollment_open ? 'Đang mở nhận ghi danh' : 'Đang đóng'}
              />
            </h2>
            <p className="admission-desc">
              {course.enrollment_open
                ? 'Sinh viên trong trường có thể tìm thấy học phần trên danh mục và gửi yêu cầu ghi danh.'
                : 'Học phần đang đóng cổng ghi danh mới. Sinh viên không thể gửi thêm yêu cầu tham gia.'}
            </p>
          </div>
        </div>

        <div>
          <Button
            type="button"
            variant={course.enrollment_open ? 'secondary' : 'primary'}
            disabled={isArchived || toggleLoading}
            onClick={handleToggleAdmission}
          >
            {toggleLoading ? (
              'Đang xử lý...'
            ) : course.enrollment_open ? (
              <>
                <Lock size={16} />
                <span>Đóng nhận ghi danh</span>
              </>
            ) : (
              <>
                <Unlock size={16} />
                <span>Mở nhận ghi danh</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="tabs-nav" role="tablist" aria-label="Chuyển chế độ quản lý">
        <button
          type="button"
          role="tab"
          id="tab-members"
          aria-selected={activeTab === 'members'}
          aria-controls="panel-members"
          className={`tab-item ${activeTab === 'members' ? 'tab-item-selected' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          <Users size={16} />
          <span>Danh sách thành viên</span>
          <span className="tab-count-badge">{membersTotalItems}</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-requests"
          aria-selected={activeTab === 'requests'}
          aria-controls="panel-requests"
          className={`tab-item ${activeTab === 'requests' ? 'tab-item-selected' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          <Clock size={16} />
          <span>Hàng đợi ghi danh</span>
          <span className="tab-count-badge">
            {requestsTotalItems}
          </span>
        </button>
      </div>

      {/* TAB 1: MEMBERS */}
      {activeTab === 'members' && (
        <section id="panel-members" role="tabpanel" aria-labelledby="tab-members">
          {/* Filter and Search Bar */}
          <div className="filter-search-card">
            <div className="search-field-wrap">
              <TextField
                label="Tìm kiếm thành viên"
                value={membersSearch}
                onChange={(e) => { setMembersSearch(e.target.value); setMembersPage(1); } }
                placeholder="Tìm theo họ tên hoặc email sinh viên..."
              />
            </div>
            <div className="filter-field-wrap">
              <SelectField
                label="Trạng thái"
                value={membersFilter}
                onChange={(e) => { setMembersFilter(e.target.value as any); setMembersPage(1); } }
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'active', label: 'Đang học' },
                  { value: 'withdrawn', label: 'Đã rút' },
                ]}
              />
            </div>
          </div>

          {membersLoading ? (
            <div className="course-members-container" aria-busy="true">
              <p className="text-muted">Đang tải danh sách thành viên...</p>
            </div>
          ) : membersError ? (
            <div className="alert-notice-box" role="alert">
              <AlertTriangle size={18} />
              <span>{membersError}</span>
              <Button variant="secondary" onClick={fetchMembers}>
                Thử lại
              </Button>
            </div>
          ) : filteredMembers.length === 0 ? (
            <EmptyState
              title="Không tìm thấy sinh viên"
              description={
                membersSearch || membersFilter !== 'all'
                  ? 'Không có sinh viên nào khớp với điều kiện tìm kiếm hoặc lọc trạng thái.'
                  : 'Lớp học phần hiện chưa có thành viên nào tham gia.'
              }
              action={
                !isArchived ? (
                  <Button variant="primary" onClick={() => setShowAddModal(true)}>
                    Thêm sinh viên vào lớp
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="members-table-container">
              <table className="npc-table">
                <thead>
                  <tr>
                    <th>Họ và tên</th>
                    <th>Email sinh viên</th>
                    <th>Trạng thái</th>
                    <th>Ngày ghi danh</th>
                    {!isArchived && <th>Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.student_name || m.student_email}</strong>
                      </td>
                      <td>{m.student_email}</td>
                      <td>
                        <Badge
                          variant={m.status === 'active' ? 'published' : 'archived'}
                          label={m.status === 'active' ? 'Đang học' : 'Đã rút'}
                        />
                      </td>
                      <td>{formatDateVN(m.added_at)}</td>
                      {!isArchived && (
                        <td>
                          {m.status === 'active' ? (
                            <button
                              type="button"
                              className="action-icon-btn danger"
                              onClick={() => setWithdrawTarget(m)}
                              title="Đánh dấu rút học phần"
                              aria-label={`Rút sinh viên ${m.student_name || m.student_email}`}
                              disabled={actionLoading[m.id]}
                            >
                              <UserMinus size={16} />
                              <span>Rút môn</span>
                            </button>
                          ) : m.status === 'withdrawn' ? (
                            <button
                              type="button"
                              className="action-icon-btn primary"
                              onClick={() => handleRestoreMember(m)}
                              title="Khôi phục trạng thái đang học"
                              aria-label={`Khôi phục sinh viên ${m.student_name || m.student_email}`}
                              disabled={actionLoading[m.id]}
                            >
                              <RotateCcw size={16} />
                              <span>{actionLoading[m.id] ? 'Đang xử lý...' : 'Khôi phục'}</span>
                            </button>
                          ) : (
                            <span className="text-muted text-sm">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!membersLoading && !membersError && membersTotalPages > 1 && (
            <div className="course-pagination" aria-label="Phân trang thành viên">
              <Button variant="secondary" disabled={membersPage <= 1} onClick={() => setMembersPage(p => p - 1)}>Trang trước</Button>
              <span>Trang {membersPage} / {membersTotalPages} · {membersTotalItems} kết quả</span>
              <Button variant="secondary" disabled={membersPage >= membersTotalPages} onClick={() => setMembersPage(p => p + 1)}>Trang sau</Button>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: ENROLLMENT REQUESTS */}
      {activeTab === 'requests' && (
        <section id="panel-requests" role="tabpanel" aria-labelledby="tab-requests">
          <div className="filter-search-card">
            <div className="search-field-wrap">
              <TextField
                label="Tìm kiếm yêu cầu"
                value={requestsSearch}
                onChange={(e) => { setRequestsSearch(e.target.value); setRequestsPage(1); } }
                placeholder="Tìm theo họ tên hoặc email sinh viên..."
              />
            </div>
            <div className="filter-field-wrap">
              <SelectField
                label="Trạng thái yêu cầu"
                value={requestsFilter}
                onChange={(e) => { setRequestsFilter(e.target.value as any); setRequestsPage(1); } }
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'pending', label: 'Chờ duyệt' },
                  { value: 'approved', label: 'Đã duyệt' },
                  { value: 'rejected', label: 'Đã từ chối' },
                  { value: 'cancelled', label: 'Đã hủy' },
                ]}
              />
            </div>
          </div>

          {requestsLoading ? (
            <div className="course-members-container" aria-busy="true">
              <p className="text-muted">Đang tải danh sách yêu cầu ghi danh...</p>
            </div>
          ) : requestsError ? (
            <div className="alert-notice-box" role="alert">
              <AlertTriangle size={18} />
              <span>{requestsError}</span>
              <Button variant="secondary" onClick={fetchRequests}>
                Thử lại
              </Button>
            </div>
          ) : filteredRequests.length === 0 ? (
            <EmptyState
              title="Không có yêu cầu ghi danh"
              description={
                requestsSearch || requestsFilter !== 'all'
                  ? 'Không có yêu cầu nào khớp với bộ lọc hiện tại.'
                  : 'Hiện không có sinh viên nào gửi yêu cầu ghi danh vào học phần này.'
              }
            />
          ) : (
            <div className="members-table-container">
              <table className="npc-table">
                <thead>
                  <tr>
                    <th>Họ và tên</th>
                    <th>Email sinh viên</th>
                    <th>Trạng thái</th>
                    <th>Thời gian gửi</th>
                    <th>Người & Thời gian duyệt</th>
                    <th>Lý do từ chối</th>
                    {!isArchived && <th>Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.student_name || r.student_email}</strong>
                      </td>
                      <td>{r.student_email}</td>
                      <td>
                        <Badge
                          variant={
                            r.status === 'approved'
                              ? 'published'
                              : r.status === 'rejected'
                              ? 'error'
                              : r.status === 'cancelled'
                              ? 'archived'
                              : 'pending'
                          }
                          label={
                            r.status === 'approved'
                              ? 'Đã duyệt'
                              : r.status === 'rejected'
                              ? 'Đã từ chối'
                              : r.status === 'cancelled'
                              ? 'Đã hủy'
                              : 'Chờ duyệt'
                          }
                        />
                      </td>
                      <td>{formatDateVN(r.requested_at)}</td>
                      <td>
                        {r.reviewed_by_name ? (
                          <span>
                            {r.reviewed_by_name}
                            <br />
                            <small className="text-muted">{formatDateVN(r.reviewed_at)}</small>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.status === 'rejected' ? (
                          <span className="text-sm">{r.rejection_reason || '—'}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      {!isArchived && (
                        <td>
                          {r.status === 'pending' ? (
                            <div className="action-btns-group">
                              <button
                                type="button"
                                className="action-icon-btn success"
                                onClick={() => handleApproveRequest(r)}
                                title="Duyệt yêu cầu ghi danh"
                                aria-label={`Duyệt yêu cầu ${r.student_name || r.student_email}`}
                                disabled={actionLoading[r.id]}
                              >
                                <CheckCircle2 size={16} />
                                <span>{actionLoading[r.id] ? 'Đang duyệt...' : 'Duyệt'}</span>
                              </button>
                              <button
                                type="button"
                                className="action-icon-btn danger"
                                onClick={() => {
                                  setRejectTarget(r);
                                  setRejectReason('');
                                }}
                                title="Từ chối yêu cầu ghi danh"
                                aria-label={`Từ chối yêu cầu ${r.student_name || r.student_email}`}
                                disabled={actionLoading[r.id]}
                              >
                                <XCircle size={16} />
                                <span>Từ chối</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted text-sm">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!requestsLoading && !requestsError && requestsTotalPages > 1 && (
            <div className="course-pagination" aria-label="Phân trang yêu cầu">
              <Button variant="secondary" disabled={requestsPage <= 1} onClick={() => setRequestsPage(p => p - 1)}>Trang trước</Button>
              <span>Trang {requestsPage} / {requestsTotalPages} · {requestsTotalItems} kết quả</span>
              <Button variant="secondary" disabled={requestsPage >= requestsTotalPages} onClick={() => setRequestsPage(p => p + 1)}>Trang sau</Button>
            </div>
          )}
        </section>
      )}

      {/* MODAL 1: Thêm sinh viên bằng email */}
      {showAddModal && (
        <Modal
          title="Thêm sinh viên vào lớp học phần"
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
        >
          <form onSubmit={handleAddMember} className="single-add-form">
            <p className="modal-lead-text">
              Nhập email tài khoản sinh viên đã có trong hệ thống trường để ghi danh trực tiếp vào học phần <strong>{course.name} ({course.code})</strong>.
            </p>
            <TextField
              label="Địa chỉ email sinh viên"
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="ví dụ: sinhvien@neu.edu.vn"
              required
              autoFocus
            />
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                disabled={addLoading}
                onClick={() => setShowAddModal(false)}
              >
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary" disabled={addLoading || !addEmail.trim()}>
                {addLoading ? 'Đang ghi danh...' : 'Ghi danh sinh viên'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: Xác nhận rút học phần */}
      {withdrawTarget && (
        <Modal
          title="Xác nhận rút học phần"
          isOpen={Boolean(withdrawTarget)}
          onClose={() => setWithdrawTarget(null)}
        >
          <div className="withdraw-modal-content">
            <p>
              Bạn có chắc chắn muốn chuyển sinh viên{' '}
              <strong>{withdrawTarget.student_name || withdrawTarget.student_email}</strong> sang trạng thái <strong>Đã rút</strong> khỏi học phần?
            </p>
            <div className="alert-notice-box">
              <AlertTriangle size={18} />
              <span>
                Sinh viên sau khi rút sẽ không thể truy cập nội dung bài học hoặc nộp bài tập. Lịch sử ghi danh và các dữ liệu liên quan vẫn được hệ thống lưu trữ đầy đủ.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                disabled={withdrawLoading}
                onClick={() => setWithdrawTarget(null)}
              >
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={withdrawLoading}
                onClick={handleConfirmWithdraw}
              >
                {withdrawLoading ? 'Đang xử lý...' : 'Xác nhận rút'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 3: Từ chối yêu cầu ghi danh */}
      {rejectTarget && (
        <Modal
          title="Từ chối yêu cầu ghi danh"
          isOpen={Boolean(rejectTarget)}
          onClose={() => setRejectTarget(null)}
        >
          <div className="reject-modal-content">
            <p className="modal-lead-text">
              Bạn đang từ chối yêu cầu ghi danh của sinh viên{' '}
              <strong>{rejectTarget.student_name || rejectTarget.student_email}</strong>. Bạn có thể cung cấp lý do từ chối để sinh viên được rõ.
            </p>
            <TextAreaField
              label="Lý do từ chối (tùy chọn)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="ví dụ: Đã đủ sĩ số lớp học phần, hoặc chưa đạt điều kiện tiên quyết..."
              rows={3}
            />
            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                disabled={rejectLoading}
                onClick={() => setRejectTarget(null)}
              >
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={rejectLoading}
                onClick={handleConfirmReject}
              >
                {rejectLoading ? 'Đang xử lý...' : 'Xác nhận từ chối'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
