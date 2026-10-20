import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField, TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { parseCSV } from '../../../shared/lib/csv';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import { ValidEmail } from '../../../shared/kernel/types';
import {
  UserPlus,
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  FileText
} from 'lucide-react';
import './AdminEligibleEmailsPage.css';

export const AdminEligibleEmailsPage: React.FC = () => {
  const { validEmails, addEligibleEmails, deleteEligibleEmail } = useDatabase();
  const { showNotification } = useNotifications();

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'teacher'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'registered' | 'unregistered'>('all');

  // Single Add Modal
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [singleEmail, setSingleEmail] = useState('');
  const [singleName, setSingleName] = useState('');
  const [singleRole, setSingleRole] = useState<'student' | 'teacher'>('student');

  // Bulk CSV Modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkCsvText, setBulkCsvText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<{
    validRows: { email: string; name: string; role: 'student' | 'teacher' }[];
    duplicateRows: string[];
    invalidRows: string[];
  } | null>(null);

  // Filtered emails
  const filteredEmails = useMemo(() => {
    return validEmails.filter(ve => {
      const isRegistered = !!ve.registeredUserId;
      if (roleFilter !== 'all' && ve.assignedRole !== roleFilter) return false;
      if (statusFilter === 'registered' && !isRegistered) return false;
      if (statusFilter === 'unregistered' && isRegistered) return false;

      if (searchQuery.trim()) {
        const qNorm = removeVietnameseAccents(searchQuery.toLowerCase());
        const nameNorm = removeVietnameseAccents(ve.fullName.toLowerCase());
        const emailNorm = ve.emailNormalized.toLowerCase();
        return nameNorm.includes(qNorm) || emailNorm.includes(qNorm);
      }
      return true;
    });
  }, [validEmails, roleFilter, statusFilter, searchQuery]);

  // SINGLE ADD
  const handleSingleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const emTrimmed = singleEmail.trim().toLowerCase();
    const nameTrimmed = singleName.trim();

    if (!emTrimmed || !nameTrimmed) {
      showNotification('error', 'Vui lòng nhập đầy đủ họ tên và email.');
      return;
    }

    if (validEmails.some(ve => ve.emailNormalized.toLowerCase() === emTrimmed)) {
      showNotification('error', `Email "${emTrimmed}" đã tồn tại trong danh sách hợp lệ.`);
      return;
    }

    const res = addEligibleEmails([{
      emailNormalized: emTrimmed,
      fullName: nameTrimmed,
      assignedRole: singleRole,
      addedAt: new Date().toISOString()
    }]);

    if (res.ok) {
      showNotification('success', `Đã thêm email "${emTrimmed}" vào danh sách hợp lệ.`);
      setShowSingleModal(false);
      setSingleEmail('');
      setSingleName('');
    } else {
      showNotification('error', res.error?.message || 'Lỗi thêm email');
    }
  };

  // BULK CSV PREVIEW
  const handlePreviewBulkCsv = () => {
    if (!bulkCsvText.trim()) {
      showNotification('error', 'Vui lòng nhập nội dung CSV.');
      return;
    }

    const parseRes = parseCSV(bulkCsvText);
    const existingEmailSet = new Set(validEmails.map(ve => ve.emailNormalized.toLowerCase()));

    const validRows: { email: string; name: string; role: 'student' | 'teacher' }[] = [];
    const duplicateRows: string[] = [];
    const invalidRows: string[] = parseRes.invalidRows.map(r => `${r.rawEmail || '(trống)'} (${r.errorMessage || 'Lỗi dòng'})`);

    parseRes.validRows.forEach(r => {
      const emailNorm = r.emailNormalized.toLowerCase();
      if (existingEmailSet.has(emailNorm)) {
        duplicateRows.push(emailNorm);
        return;
      }
      validRows.push({
        email: emailNorm,
        name: r.fullName || 'Người dùng',
        role: r.assignedRole || 'student'
      });
      existingEmailSet.add(emailNorm);
    });

    setBulkPreview({ validRows, duplicateRows, invalidRows });
  };

  const handleConfirmBulkAdd = () => {
    if (!bulkPreview || bulkPreview.validRows.length === 0) return;

    const toInsert: ValidEmail[] = bulkPreview.validRows.map(r => ({
      emailNormalized: r.email,
      fullName: r.name,
      assignedRole: r.role,
      addedAt: new Date().toISOString()
    }));

    const res = addEligibleEmails(toInsert);
    if (res.ok) {
      showNotification('success', `Đã nhập thành công ${toInsert.length} email hợp lệ.`);
      setShowBulkModal(false);
      setBulkCsvText('');
      setBulkPreview(null);
    } else {
      showNotification('error', res.error?.message || 'Lỗi nhập danh sách');
    }
  };

  const handleDeleteEmail = (ve: ValidEmail) => {
    if (ve.registeredUserId) {
      showNotification('error', 'Email đã được đăng ký tài khoản hoạt động, không thể xóa.');
      return;
    }

    if (window.confirm(`Xóa email "${ve.emailNormalized}" khỏi danh sách được phép đăng ký?`)) {
      const res = deleteEligibleEmail(ve.emailNormalized);
      if (res.ok) {
        showNotification('success', `Đã xóa email "${ve.emailNormalized}".`);
      } else {
        showNotification('error', res.error?.message || 'Lỗi xóa email');
      }
    }
  };

  return (
    <div className="admin-emails-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/ad' },
              { label: 'Email hợp lệ' }
            ]}
          />
          <h1 className="page-main-heading">Danh sách Email hợp lệ toàn trường</h1>
          <p className="page-subtitle">
            Kiểm soát danh sách cán bộ, giảng viên và sinh viên đủ điều kiện khởi tạo tài khoản trên hệ thống.
          </p>
        </div>

        <div className="header-actions">
          <Button type="button" variant="secondary" onClick={() => setShowBulkModal(true)}>
            <Upload size={16} />
            <span>Nhập tệp CSV</span>
          </Button>
          <Button type="button" variant="primary" onClick={() => setShowSingleModal(true)}>
            <UserPlus size={16} />
            <span>Thêm một email</span>
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label="Tìm kiếm theo email hoặc họ tên"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Nhập email hoặc tên cần tìm..."
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Vai trò"
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value as any)}
            options={[
              { value: 'all', label: 'Tất cả vai trò' },
              { value: 'student', label: 'Sinh viên' },
              { value: 'teacher', label: 'Giảng viên' }
            ]}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Trạng thái kích hoạt"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'all', label: 'Tất cả trạng thái' },
              { value: 'registered', label: 'Đã đăng ký tài khoản' },
              { value: 'unregistered', label: 'Chưa đăng ký' }
            ]}
          />
        </div>
      </div>

      {/* Table */}
      {filteredEmails.length === 0 ? (
        <EmptyState
          title="Không tìm thấy email"
          description="Không có email nào phù hợp với bộ lọc tìm kiếm hiện tại."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('all');
                setStatusFilter('all');
              }}
            >
              Xóa bộ lọc
            </Button>
          }
        />
      ) : (
        <div className="emails-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Địa chỉ Email</th>
                <th>Họ và tên</th>
                <th>Vai trò được cấp</th>
                <th>Trạng thái tài khoản</th>
                <th>Ngày cập nhật</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmails.map(ve => (
                <tr key={ve.emailNormalized}>
                  <td>
                    <strong>{ve.emailNormalized}</strong>
                  </td>
                  <td>{ve.fullName}</td>
                  <td>
                    <span className="role-tag">
                      {ve.assignedRole === 'teacher' ? 'Giảng viên' : 'Sinh viên'}
                    </span>
                  </td>
                  <td>
                    <Badge
                      variant={ve.registeredUserId ? 'published' : 'draft'}
                      label={ve.registeredUserId ? 'Đã kích hoạt' : 'Chưa đăng ký'}
                    />
                  </td>
                  <td>{formatDateVN(ve.addedAt)}</td>
                  <td>
                    {ve.registeredUserId ? (
                      <span
                        className="text-muted text-disabled-btn"
                        title="Email đã kích hoạt tài khoản thực tế, không thể xóa"
                      >
                        Đã đăng ký (Khóa)
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="icon-delete-btn"
                        onClick={() => handleDeleteEmail(ve)}
                        title="Xóa email khỏi danh sách hợp lệ"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Single Add */}
      {showSingleModal && (
        <Modal
          title="Thêm email hợp lệ đơn lẻ"
          isOpen={showSingleModal}
          onClose={() => setShowSingleModal(false)}
        >
          <form onSubmit={handleSingleAdd} className="modal-form-stack">
            <TextField
              label="Địa chỉ email trường"
              required
              type="email"
              value={singleEmail}
              onChange={e => setSingleEmail(e.target.value)}
              placeholder="nguyenvana@school.edu.vn"
            />
            <TextField
              label="Họ và tên đầy đủ"
              required
              value={singleName}
              onChange={e => setSingleName(e.target.value)}
              placeholder="Nguyễn Văn A"
            />
            <SelectField
              label="Vai trò cấp quyền"
              value={singleRole}
              onChange={e => setSingleRole(e.target.value as any)}
              options={[
                { value: 'student', label: 'Sinh viên' },
                { value: 'teacher', label: 'Giảng viên' }
              ]}
            />
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowSingleModal(false)}>
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary">
                Lưu vào danh sách
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Bulk CSV Import */}
      {showBulkModal && (
        <Modal
          title="Nhập danh sách Email hợp lệ qua CSV"
          isOpen={showBulkModal}
          onClose={() => {
            setShowBulkModal(false);
            setBulkPreview(null);
          }}
        >
          <div className="bulk-csv-stack">
            <TextAreaField
              label="Dán dữ liệu CSV (Có hỗ trợ tiêu đề email, name, role)"
              required
              value={bulkCsvText}
              onChange={e => setBulkCsvText(e.target.value)}
              placeholder="email,name,role&#10;sinhvien1@school.edu.vn,Nguyễn Văn 1,student&#10;giangvien1@school.edu.vn,TS. Trần Văn 2,teacher"
              rows={6}
              helperText="Hệ thống hỗ trợ chuẩn RFC 4180, loại bỏ UTF-8 BOM và các dấu ngoặc kép an toàn."
            />

            <div className="preview-action-row">
              <Button type="button" variant="secondary" onClick={handlePreviewBulkCsv}>
                <FileText size={16} />
                <span>Kiểm tra & Xem trước danh sách</span>
              </Button>
            </div>

            {bulkPreview && (
              <div className="csv-preview-results-box">
                <div className="preview-pill success">
                  <CheckCircle2 size={16} />
                  <span>{bulkPreview.validRows.length} dòng hợp lệ sẵn sàng nhập</span>
                </div>
                {bulkPreview.duplicateRows.length > 0 && (
                  <div className="preview-pill info">
                    <span>{bulkPreview.duplicateRows.length} email trùng lặp (đã bỏ qua)</span>
                  </div>
                )}
                {bulkPreview.invalidRows.length > 0 && (
                  <div className="preview-pill danger">
                    <XCircle size={16} />
                    <span>{bulkPreview.invalidRows.length} dòng lỗi định dạng</span>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowBulkModal(false);
                  setBulkPreview(null);
                }}
              >
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!bulkPreview || bulkPreview.validRows.length === 0}
                onClick={handleConfirmBulkAdd}
              >
                Xác nhận nhập vào hệ thống
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
