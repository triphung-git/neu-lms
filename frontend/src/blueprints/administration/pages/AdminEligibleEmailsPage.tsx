import {uiText} from "../../../shared/i18n/translate";
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
      showNotification('error', uiText("Vui lòng nhập đầy đủ họ tên và email."));
      return;
    }

    if (validEmails.some(ve => ve.emailNormalized.toLowerCase() === emTrimmed)) {
      showNotification('error', uiText("Email \"{0}\" đã tồn tại trong danh sách hợp lệ.",[emTrimmed]));
      return;
    }

    const res = addEligibleEmails([{
      emailNormalized: emTrimmed,
      fullName: nameTrimmed,
      assignedRole: singleRole,
      addedAt: new Date().toISOString()
    }]);

    if (res.ok) {
      showNotification('success', uiText("Đã thêm email \"{0}\" vào danh sách hợp lệ.",[emTrimmed]));
      setShowSingleModal(false);
      setSingleEmail('');
      setSingleName('');
    } else {
      showNotification('error', res.error?.message || uiText("Lỗi thêm email"));
    }
  };

  // BULK CSV PREVIEW
  const handlePreviewBulkCsv = () => {
    if (!bulkCsvText.trim()) {
      showNotification('error', uiText("Vui lòng nhập nội dung CSV."));
      return;
    }

    const parseRes = parseCSV(bulkCsvText);
    const existingEmailSet = new Set(validEmails.map(ve => ve.emailNormalized.toLowerCase()));

    const validRows: { email: string; name: string; role: 'student' | 'teacher' }[] = [];
    const duplicateRows: string[] = [];
    const invalidRows: string[] = parseRes.invalidRows.map(r => `${r.rawEmail || uiText("(trống)")} (${r.errorMessage || uiText("Lỗi dòng")})`);

    parseRes.validRows.forEach(r => {
      const emailNorm = r.emailNormalized.toLowerCase();
      if (existingEmailSet.has(emailNorm)) {
        duplicateRows.push(emailNorm);
        return;
      }
      validRows.push({
        email: emailNorm,
        name: r.fullName || uiText("Người dùng"),
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
      showNotification('success', uiText("Đã nhập thành công {0} email hợp lệ.",[toInsert.length]));
      setShowBulkModal(false);
      setBulkCsvText('');
      setBulkPreview(null);
    } else {
      showNotification('error', res.error?.message || uiText("Lỗi nhập danh sách"));
    }
  };

  const handleDeleteEmail = (ve: ValidEmail) => {
    if (ve.registeredUserId) {
      showNotification('error', uiText("Email đã được đăng ký tài khoản hoạt động, không thể xóa."));
      return;
    }

    if (window.confirm(uiText("Xóa email \"{0}\" khỏi danh sách được phép đăng ký?",[ve.emailNormalized]))) {
      const res = deleteEligibleEmail(ve.emailNormalized);
      if (res.ok) {
        showNotification('success', uiText("Đã xóa email \"{0}\".",[ve.emailNormalized]));
      } else {
        showNotification('error', res.error?.message || uiText("Lỗi xóa email"));
      }
    }
  };

  return (
    <div className="admin-emails-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: uiText("Bàn làm việc"), path: '/ad' },
              { label: uiText("Email hợp lệ") }
            ]}
          />
          <h1 className="page-main-heading">{uiText("Danh sách Email hợp lệ toàn trường")}</h1>
          <p className="page-subtitle">
            {uiText("Kiểm soát danh sách cán bộ, giảng viên và sinh viên đủ điều kiện khởi tạo tài khoản trên hệ thống.")}</p>
        </div>

        <div className="header-actions">
          <Button type="button" variant="secondary" onClick={() => setShowBulkModal(true)}>
            <Upload size={16} />
            <span>{uiText("Nhập tệp CSV")}</span>
          </Button>
          <Button type="button" variant="primary" onClick={() => setShowSingleModal(true)}>
            <UserPlus size={16} />
            <span>{uiText("Thêm một email")}</span>
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label={uiText("Tìm kiếm theo email hoặc họ tên")}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={uiText("Nhập email hoặc tên cần tìm...")}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label={uiText("Vai trò")}
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value as any)}
            options={[
              { value: 'all', label: uiText("Tất cả vai trò") },
              { value: 'student', label: uiText("Sinh viên") },
              { value: 'teacher', label: uiText("Giảng viên") }
            ]}
          />
        </div>

        <div className="filter-col">
          <SelectField
            label={uiText("Trạng thái kích hoạt")}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'all', label: uiText("Tất cả trạng thái") },
              { value: 'registered', label: uiText("Đã đăng ký tài khoản") },
              { value: 'unregistered', label: uiText("Chưa đăng ký") }
            ]}
          />
        </div>
      </div>

      {/* Table */}
      {filteredEmails.length === 0 ? (
        <EmptyState
          title={uiText("Không tìm thấy email")}
          description={uiText("Không có email nào phù hợp với bộ lọc tìm kiếm hiện tại.")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('all');
                setStatusFilter('all');
              }}
            >
              {uiText("Xóa bộ lọc")}</Button>
          }
        />
      ) : (
        <div className="emails-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>{uiText("Địa chỉ Email")}</th>
                <th>{uiText("Họ và tên")}</th>
                <th>{uiText("Vai trò được cấp")}</th>
                <th>{uiText("Trạng thái tài khoản")}</th>
                <th>{uiText("Ngày cập nhật")}</th>
                <th>{uiText("Thao tác")}</th>
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
                      {ve.assignedRole === 'teacher' ? uiText("Giảng viên") : uiText("Sinh viên")}
                    </span>
                  </td>
                  <td>
                    <Badge
                      variant={ve.registeredUserId ? 'published' : 'draft'}
                      label={ve.registeredUserId ? uiText("Đã kích hoạt") : uiText("Chưa đăng ký")}
                    />
                  </td>
                  <td>{formatDateVN(ve.addedAt)}</td>
                  <td>
                    {ve.registeredUserId ? (
                      <span
                        className="text-muted text-disabled-btn"
                        title={uiText("Email đã kích hoạt tài khoản thực tế, không thể xóa")}
                      >
                        {uiText("Đã đăng ký (Khóa)")}</span>
                    ) : (
                      <button
                        type="button"
                        className="icon-delete-btn"
                        onClick={() => handleDeleteEmail(ve)}
                        title={uiText("Xóa email khỏi danh sách hợp lệ")}
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
          title={uiText("Thêm email hợp lệ đơn lẻ")}
          isOpen={showSingleModal}
          onClose={() => setShowSingleModal(false)}
        >
          <form onSubmit={handleSingleAdd} className="modal-form-stack">
            <TextField
              label={uiText("Địa chỉ email trường")}
              required
              type="email"
              value={singleEmail}
              onChange={e => setSingleEmail(e.target.value)}
              placeholder="nguyenvana@school.edu.vn"
            />
            <TextField
              label={uiText("Họ và tên đầy đủ")}
              required
              value={singleName}
              onChange={e => setSingleName(e.target.value)}
              placeholder={uiText("Nguyễn Văn A")}
            />
            <SelectField
              label={uiText("Vai trò cấp quyền")}
              value={singleRole}
              onChange={e => setSingleRole(e.target.value as any)}
              options={[
                { value: 'student', label: uiText("Sinh viên") },
                { value: 'teacher', label: uiText("Giảng viên") }
              ]}
            />
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowSingleModal(false)}>
                {uiText("Hủy bỏ")}</Button>
              <Button type="submit" variant="primary">
                {uiText("Lưu vào danh sách")}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Bulk CSV Import */}
      {showBulkModal && (
        <Modal
          title={uiText("Nhập danh sách Email hợp lệ qua CSV")}
          isOpen={showBulkModal}
          onClose={() => {
            setShowBulkModal(false);
            setBulkPreview(null);
          }}
        >
          <div className="bulk-csv-stack">
            <TextAreaField
              label={uiText("Dán dữ liệu CSV (Có hỗ trợ tiêu đề email, name, role)")}
              required
              value={bulkCsvText}
              onChange={e => setBulkCsvText(e.target.value)}
              placeholder={uiText("email,name,role&#10;sinhvien1@school.edu.vn,Nguyễn Văn 1,student&#10;giangvien1@school.edu.vn,TS. Trần Văn 2,teacher")}
              rows={6}
              helperText="Hệ thống hỗ trợ chuẩn RFC 4180, loại bỏ UTF-8 BOM và các dấu ngoặc kép an toàn."
            />

            <div className="preview-action-row">
              <Button type="button" variant="secondary" onClick={handlePreviewBulkCsv}>
                <FileText size={16} />
                <span>{uiText("Kiểm tra & Xem trước danh sách")}</span>
              </Button>
            </div>

            {bulkPreview && (
              <div className="csv-preview-results-box">
                <div className="preview-pill success">
                  <CheckCircle2 size={16} />
                  <span>{bulkPreview.validRows.length} {uiText(" dòng hợp lệ sẵn sàng nhập")}</span>
                </div>
                {bulkPreview.duplicateRows.length > 0 && (
                  <div className="preview-pill info">
                    <span>{bulkPreview.duplicateRows.length} {uiText(" email trùng lặp (đã bỏ qua)")}</span>
                  </div>
                )}
                {bulkPreview.invalidRows.length > 0 && (
                  <div className="preview-pill danger">
                    <XCircle size={16} />
                    <span>{bulkPreview.invalidRows.length} {uiText(" dòng lỗi định dạng")}</span>
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
                {uiText("Hủy bỏ")}</Button>
              <Button
                type="button"
                variant="primary"
                disabled={!bulkPreview || bulkPreview.validRows.length === 0}
                onClick={handleConfirmBulkAdd}
              >
                {uiText("Xác nhận nhập vào hệ thống")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
