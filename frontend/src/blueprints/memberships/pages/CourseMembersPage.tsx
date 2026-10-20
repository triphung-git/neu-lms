import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField, TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import type { Membership, User, ValidEmail } from '../../../shared/kernel/types';
import {
  UserPlus,
  Upload,
  UserMinus,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import './CourseMembersPage.css';

interface BulkPreviewResult {
  validUsers: { id: string; name: string; email: string }[];
  invalidEmails: string[];
  alreadyEnrolled: string[];
}

export const CourseMembersPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const { courses, memberships, users, validEmails, addMembers, withdrawMembership, restoreMembership } = useDatabase();
  const { notifySuccess, notifyError, notifyInfo } = useNotification();
  const navigate = useNavigate();

  const course = courses.find((c) => c.id === monId || c.code.toLowerCase() === monId?.toLowerCase());
  const isArchived = course?.status === 'archived';

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'withdrawn' | 'pending'>('all');

  // Single Add Modal
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [singleEmail, setSingleEmail] = useState('');

  // Bulk Add Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkInputText, setBulkInputText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewResult | null>(null);

  // Withdraw confirm modal
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; userName: string; userEmail: string } | null>(null);

  const courseMembers = useMemo(() => {
    if (!course) return [];
    return memberships.filter((m: Membership) => m.courseId === course.id);
  }, [memberships, course]);

  const enrichedMembers = useMemo(() => {
    return courseMembers.map((m: Membership) => {
      const user = users.find((u: User) => u.id === m.userId || u.emailNormalized.toLowerCase() === m.emailNormalized.toLowerCase());
      return {
        id: m.id,
        userId: m.userId,
        userName: user?.fullName || m.emailNormalized,
        userEmail: m.emailNormalized,
        status: m.status,
        addedAt: m.addedAt,
      };
    });
  }, [courseMembers, users]);

  const filteredMembers = useMemo(() => {
    return enrichedMembers.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const qNorm = removeVietnameseAccents(searchQuery.toLowerCase());
        const nameNorm = removeVietnameseAccents(m.userName.toLowerCase());
        const emailNorm = m.userEmail.toLowerCase();
        return nameNorm.includes(qNorm) || emailNorm.includes(qNorm);
      }

      return true;
    });
  }, [enrichedMembers, statusFilter, searchQuery]);

  if (!course) {
    return (
      <div className="course-members-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại trên hệ thống."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  // SINGLE ADD HANDLER
  const handleSingleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const emailTrimmed = singleEmail.trim().toLowerCase();
    if (!emailTrimmed) {
      notifyError('Vui lòng nhập địa chỉ email sinh viên.');
      return;
    }

    // Check if user exists
    const user = users.find((u: User) => u.emailNormalized.toLowerCase() === emailTrimmed);
    if (!user) {
      // Check in validEmails
      const valid = validEmails.find((ve: ValidEmail) => ve.emailNormalized.toLowerCase() === emailTrimmed && ve.assignedRole === 'student');
      if (!valid) {
        notifyError(`Email "${emailTrimmed}" không thuộc danh sách sinh viên hợp lệ của trường.`);
        return;
      }
      // Add as pending user
      const res = addMembers(course.id, [{
        userId: `user-temp-${Date.now()}`,
        userName: valid.fullName,
        userEmail: valid.emailNormalized,
        status: 'pending'
      }]);
      if (res.ok) {
        notifySuccess(`Đã thêm ${valid.fullName} vào danh sách chờ xác nhận tài khoản.`);
        setShowSingleModal(false);
        setSingleEmail('');
      } else {
        notifyError(res.error?.message || 'Có lỗi xảy ra');
      }
      return;
    }

    if (user.role !== 'student') {
      notifyError(`Tài khoản ${user.fullName} có vai trò "${user.role}", không thể thêm vào lớp học phần với tư cách sinh viên.`);
      return;
    }

    // Check already enrolled
    const existing = courseMembers.find((m: Membership) => m.userId === user.id || m.emailNormalized.toLowerCase() === emailTrimmed);
    if (existing) {
      if (existing.status === 'withdrawn') {
        restoreMembership(existing.id);
        notifySuccess(`Sinh viên ${user.fullName} đã được khôi phục trạng thái đang học.`);
        setShowSingleModal(false);
        setSingleEmail('');
        return;
      }
      notifyInfo(`Sinh viên ${user.fullName} đã có tên trong lớp học phần.`);
      return;
    }

    const res = addMembers(course.id, [{
      userId: user.id,
      userName: user.fullName,
      userEmail: user.emailNormalized,
      status: 'active'
    }]);

    if (res.ok) {
      notifySuccess(`Đã thêm sinh viên ${user.fullName} vào lớp.`);
      setShowSingleModal(false);
      setSingleEmail('');
    } else {
      notifyError(res.error?.message || 'Có lỗi xảy ra');
    }
  };

  // BULK PREVIEW HANDLER
  const handlePreviewBulk = () => {
    const rawEmails = bulkInputText
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    const uniqueEmails = Array.from(new Set(rawEmails));
    const validUsers: { id: string; name: string; email: string }[] = [];
    const invalidEmails: string[] = [];
    const alreadyEnrolled: string[] = [];

    const enrolledEmailSet = new Set(courseMembers.map((m: Membership) => m.emailNormalized.toLowerCase()));

    for (const em of uniqueEmails) {
      if (enrolledEmailSet.has(em)) {
        alreadyEnrolled.push(em);
        continue;
      }

      // Check registered users
      const u = users.find((usr: User) => usr.emailNormalized.toLowerCase() === em && usr.role === 'student');
      if (u) {
        validUsers.push({ id: u.id, name: u.fullName, email: u.emailNormalized });
        continue;
      }

      // Check eligible valid emails
      const ve = validEmails.find((v: ValidEmail) => v.emailNormalized.toLowerCase() === em && v.assignedRole === 'student');
      if (ve) {
        validUsers.push({ id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: ve.fullName, email: ve.emailNormalized });
        continue;
      }

      invalidEmails.push(em);
    }

    setBulkPreview({ validUsers, invalidEmails, alreadyEnrolled });
  };

  const handleConfirmBulk = () => {
    if (!bulkPreview || bulkPreview.validUsers.length === 0) return;

    const toAdd = bulkPreview.validUsers.map((vu) => ({
      userId: vu.id,
      userName: vu.name,
      userEmail: vu.email,
      status: 'active' as const
    }));

    const res = addMembers(course.id, toAdd);
    if (res.ok) {
      notifySuccess(`Đã ghi danh thành công ${toAdd.length} sinh viên vào lớp.`);
      setShowBulkModal(false);
      setBulkInputText('');
      setBulkPreview(null);
    } else {
      notifyError(res.error?.message || 'Có lỗi xảy ra');
    }
  };

  // WITHDRAW / RESTORE HANDLERS
  const handleConfirmWithdraw = () => {
    if (!withdrawTarget) return;
    withdrawMembership(withdrawTarget.id);
    notifySuccess(`Đã chuyển sinh viên ${withdrawTarget.userName} sang trạng thái Đã rút.`);
    setWithdrawTarget(null);
  };

  const handleRestore = (item: { id: string; userName: string }) => {
    restoreMembership(item.id);
    notifySuccess(`Đã khôi phục trạng thái Đang học cho ${item.userName}.`);
  };

  return (
    <div className="course-members-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Thành viên lớp học' }
            ]}
          />
          <h1 className="page-main-heading">Danh sách sinh viên lớp học</h1>
          <p className="page-subtitle">
            Quản lý quyền truy cập học phần, thêm sinh viên theo danh sách hoặc xử lý rút học phần.
          </p>
        </div>

        {!isArchived && (
          <div className="header-actions">
            <Button type="button" variant="secondary" onClick={() => setShowBulkModal(true)}>
              <Upload size={16} />
              <span>Dán danh sách email</span>
            </Button>
            <Button type="button" variant="primary" onClick={() => setShowSingleModal(true)}>
              <UserPlus size={16} />
              <span>Thêm sinh viên</span>
            </Button>
          </div>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Toàn bộ danh sách sinh viên ở trạng thái chỉ đọc. Không thể thêm mới hoặc rút sinh viên.
          </span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <div className="search-field-wrap">
          <TextField
            label="Tìm kiếm sinh viên"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo họ tên hoặc email sinh viên..."
          />
        </div>
        <div className="filter-field-wrap">
          <SelectField
            label="Trạng thái"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'all', label: `Tất cả (${courseMembers.length})` },
              { value: 'active', label: `Đang học (${courseMembers.filter((m: Membership) => m.status === 'active').length})` },
              { value: 'withdrawn', label: `Đã rút (${courseMembers.filter((m: Membership) => m.status === 'withdrawn').length})` },
              { value: 'pending', label: `Chờ đăng ký (${courseMembers.filter((m: Membership) => m.status === 'pending').length})` }
            ]}
          />
        </div>
      </div>

      {/* Members Table */}
      {filteredMembers.length === 0 ? (
        <EmptyState
          title="Không tìm thấy sinh viên"
          description="Chưa có sinh viên nào khớp với điều kiện tìm kiếm hoặc lớp chưa có thành viên."
          action={
            !isArchived ? (
              <Button variant="primary" onClick={() => setShowSingleModal(true)}>
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
                    <strong>{m.userName}</strong>
                  </td>
                  <td>{m.userEmail}</td>
                  <td>
                    <Badge
                      variant={
                        m.status === 'active'
                          ? 'published'
                          : m.status === 'withdrawn'
                          ? 'archived'
                          : 'draft'
                      }
                      label={
                        m.status === 'active'
                          ? 'Đang học'
                          : m.status === 'withdrawn'
                          ? 'Đã rút'
                          : 'Chờ đăng ký'
                      }
                    />
                  </td>
                  <td>{formatDateVN(m.addedAt)}</td>
                  {!isArchived && (
                    <td>
                      {m.status === 'active' ? (
                        <button
                          type="button"
                          className="action-icon-btn danger"
                          onClick={() => setWithdrawTarget({ id: m.id, userName: m.userName, userEmail: m.userEmail })}
                          title="Đánh dấu rút học phần"
                          aria-label={`Rút sinh viên ${m.userName}`}
                        >
                          <UserMinus size={16} />
                          <span>Rút môn</span>
                        </button>
                      ) : m.status === 'withdrawn' ? (
                        <button
                          type="button"
                          className="action-icon-btn primary"
                          onClick={() => handleRestore({ id: m.id, userName: m.userName })}
                          title="Khôi phục trạng thái đang học"
                          aria-label={`Khôi phục sinh viên ${m.userName}`}
                        >
                          <RotateCcw size={16} />
                          <span>Khôi phục</span>
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

      {/* Modal 1: Single Add */}
      {showSingleModal && (
        <Modal
          title="Thêm sinh viên vào lớp học phần"
          isOpen={showSingleModal}
          onClose={() => setShowSingleModal(false)}
        >
          <form onSubmit={handleSingleAdd} className="single-add-form">
            <p className="modal-lead-text">
              Nhập email sinh viên trường để ghi danh vào lớp <strong>{course.name} ({course.code})</strong>.
            </p>
            <TextField
              label="Địa chỉ email sinh viên"
              type="email"
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              placeholder="ví dụ: sinh-vien@example.edu.vn"
              required
              autoFocus
            />
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowSingleModal(false)}>
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary">
                Ghi danh sinh viên
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal 2: Bulk Add via Paste */}
      {showBulkModal && (
        <Modal
          title="Dán danh sách email sinh viên"
          isOpen={showBulkModal}
          onClose={() => {
            setShowBulkModal(false);
            setBulkPreview(null);
            setBulkInputText('');
          }}
        >
          <div className="bulk-modal-content">
            {!bulkPreview ? (
              <>
                <p className="modal-lead-text">
                  Dán danh sách email từ Excel, CSV hoặc văn bản thô (mỗi email một dòng hoặc cách nhau bằng dấu phẩy). Hệ thống sẽ đối soát với danh sách email hợp lệ của trường trước khi ghi danh.
                </p>
                <TextAreaField
                  label="Danh sách email"
                  value={bulkInputText}
                  onChange={(e) => setBulkInputText(e.target.value)}
                  placeholder="sv1@example.edu.vn&#10;sv2@example.edu.vn&#10;sv3@example.edu.vn"
                  rows={6}
                />
                <div className="modal-actions-bar">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowBulkModal(false);
                      setBulkInputText('');
                    }}
                  >
                    Hủy bỏ
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!bulkInputText.trim()}
                    onClick={handlePreviewBulk}
                  >
                    Kiểm tra danh sách
                  </Button>
                </div>
              </>
            ) : (
              <div className="bulk-preview-stack">
                <h3 className="preview-heading">Kết quả đối soát danh sách:</h3>

                {/* Valid to add */}
                <div className="preview-section valid-box">
                  <div className="sec-header">
                    <CheckCircle2 size={18} className="icon-success" />
                    <strong>Hợp lệ để ghi danh ({bulkPreview.validUsers.length})</strong>
                  </div>
                  {bulkPreview.validUsers.length > 0 ? (
                    <ul className="preview-list">
                      {bulkPreview.validUsers.map((u) => (
                        <li key={u.id}>
                          <span>{u.name}</span>
                          <code>{u.email}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted text-sm">Không có email mới hợp lệ.</p>
                  )}
                </div>

                {/* Already enrolled */}
                {bulkPreview.alreadyEnrolled.length > 0 && (
                  <div className="preview-section warning-box">
                    <div className="sec-header">
                      <AlertTriangle size={18} className="icon-warning" />
                      <strong>Đã có trong lớp ({bulkPreview.alreadyEnrolled.length})</strong>
                    </div>
                    <ul className="preview-list">
                      {bulkPreview.alreadyEnrolled.map((e) => (
                        <li key={e}>
                          <code>{e}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Invalid / Not eligible */}
                {bulkPreview.invalidEmails.length > 0 && (
                  <div className="preview-section danger-box">
                    <div className="sec-header">
                      <XCircle size={18} className="icon-danger" />
                      <strong>Không hợp lệ ({bulkPreview.invalidEmails.length})</strong>
                    </div>
                    <p className="text-sm text-danger-soft">
                      Những email này không thuộc danh sách sinh viên hợp lệ của trường hoặc sai định dạng:
                    </p>
                    <ul className="preview-list">
                      {bulkPreview.invalidEmails.map((e) => (
                        <li key={e}>
                          <code>{e}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="modal-actions-bar">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setBulkPreview(null)}
                  >
                    Chỉnh sửa lại danh sách
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={bulkPreview.validUsers.length === 0}
                    onClick={handleConfirmBulk}
                  >
                    Xác nhận ghi danh ({bulkPreview.validUsers.length})
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal 3: Confirm Withdraw */}
      {withdrawTarget && (
        <Modal
          title="Xác nhận rút học phần"
          isOpen={Boolean(withdrawTarget)}
          onClose={() => setWithdrawTarget(null)}
        >
          <div className="withdraw-modal-content">
            <p>
              Bạn có chắc chắn muốn chuyển sinh viên <strong>{withdrawTarget.userName}</strong> ({withdrawTarget.userEmail}) sang trạng thái <strong>Đã rút</strong>?
            </p>
            <div className="alert-notice-box">
              <AlertTriangle size={18} />
              <span>
                Sinh viên sau khi rút sẽ không thể nộp bài tập mới hoặc truy cập nội dung bài học. Lịch sử bài nộp và điểm đã có vẫn được bảo lưu.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setWithdrawTarget(null)}>
                Hủy bỏ
              </Button>
              <Button type="button" variant="danger" onClick={handleConfirmWithdraw}>
                Xác nhận rút
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
