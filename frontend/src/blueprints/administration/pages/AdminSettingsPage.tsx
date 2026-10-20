import React, { useState } from 'react';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField } from '../../../shared/ui/TextField';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { ShieldCheck, Bot, Mail, FileCheck, Save } from 'lucide-react';
import './AdminSettingsPage.css';

export const AdminSettingsPage: React.FC = () => {
  const { systemSettings, updateSystemSettings } = useDatabase();
  const { showNotification } = useNotifications();

  // Form states initialized from systemSettings
  const [formatsStr, setFormatsStr] = useState((systemSettings.studentSubmissionFormats || ['pdf', 'docx', 'zip']).join(', '));
  const [maxSizeMb, setMaxSizeMb] = useState((systemSettings.maxSubmissionFileMB || 50).toString());
  const [enableAi, setEnableAi] = useState(systemSettings.aiEnabled ?? true);
  const [teacherQuota, setTeacherQuota] = useState((systemSettings.teacherMonthlyAIQuota || 100).toString());
  const [studentQuota, setStudentQuota] = useState((systemSettings.studentDailyAIQuota || 10).toString());
  const [enableEmail, setEnableEmail] = useState(systemSettings.emailEnabled ?? true);

  // Confirm Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate formats
    const parsedFormats = formatsStr.split(',').map((f: string) => f.trim().toLowerCase()).filter(Boolean);
    if (parsedFormats.length === 0) {
      showNotification('error', 'Định dạng tệp nộp bài không được để trống.');
      return;
    }

    // Validate size
    const sizeNum = parseInt(maxSizeMb, 10);
    if (isNaN(sizeNum) || sizeNum < 1) {
      showNotification('error', 'Dung lượng tệp tối đa phải là số nguyên lớn hơn hoặc bằng 1 MB.');
      return;
    }

    // Validate quotas
    const tQuotaNum = parseInt(teacherQuota, 10);
    const sQuotaNum = parseInt(studentQuota, 10);
    if (isNaN(tQuotaNum) || tQuotaNum < 1 || isNaN(sQuotaNum) || sQuotaNum < 1) {
      showNotification('error', 'Hạn mức AI phải là số nguyên dương lớn hơn hoặc bằng 1.');
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmSave = () => {
    setIsSaving(true);
    const parsedFormats = formatsStr.split(',').map((f: string) => f.trim().toLowerCase()).filter(Boolean);

    const res = updateSystemSettings({
      studentSubmissionFormats: parsedFormats,
      maxSubmissionFileMB: parseInt(maxSizeMb, 10),
      aiEnabled: enableAi,
      teacherMonthlyAIQuota: parseInt(teacherQuota, 10),
      studentDailyAIQuota: parseInt(studentQuota, 10),
      emailEnabled: enableEmail
    });

    setIsSaving(false);
    setShowConfirmModal(false);

    if (res.ok) {
      showNotification('success', 'Đã lưu và áp dụng cấu hình hệ thống toàn trường.');
    } else {
      showNotification('error', res.error?.message || 'Lỗi khi lưu cấu hình');
    }
  };

  return (
    <div className="admin-settings-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Cấu hình hệ thống' }
          ]}
        />
        <h1 className="page-heading">Cấu hình hệ thống toàn trường</h1>
        <p className="page-subheading">
          Thiết lập các tham số vận hành, hạn ngạch tài nguyên, chính sách nộp bài và an toàn thông tin.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="settings-form-layout">
        {/* SECTION 1: SUBMISSION CONSTRAINTS */}
        <section className="settings-card">
          <div className="card-top-header">
            <FileCheck size={22} className="card-icon blue" />
            <div>
              <h2 className="card-title">1. Quy định nộp bài tập sinh viên</h2>
              <p className="card-subtitle">Ràng buộc kỹ thuật khi sinh viên nộp bài làm lên hệ thống.</p>
            </div>
          </div>

          <div className="card-fields-grid">
            <TextField
              label="Các định dạng tệp cho phép (phân tách bởi dấu phẩy)"
              required
              value={formatsStr}
              onChange={e => setFormatsStr(e.target.value)}
              placeholder="pdf, docx, pptx, zip"
              helperText="Hệ thống từ chối các định dạng không nằm trong danh mục này."
            />

            <TextField
              label="Dung lượng tệp tối đa (MB)"
              required
              type="number"
              min="1"
              max="500"
              value={maxSizeMb}
              onChange={e => setMaxSizeMb(e.target.value)}
              helperText="Giới hạn kích thước tệp tải lên (khuyến nghị 25 MB)."
            />
          </div>
        </section>

        {/* SECTION 2: AI ASSISTANT SETTINGS */}
        <section className="settings-card">
          <div className="card-top-header">
            <Bot size={22} className="card-icon purple" />
            <div>
              <h2 className="card-title">2. Trợ lý học vụ AI & Hạn ngạch</h2>
              <p className="card-subtitle">Cấu hình tính năng AI hỗ trợ học liệu và tóm tắt đề bài.</p>
            </div>
          </div>

          <div className="card-fields-grid">
            <div className="switch-row-box">
              <label className="switch-toggle-label">
                <input
                  type="checkbox"
                  checked={enableAi}
                  onChange={e => setEnableAi(e.target.checked)}
                />
                <span className="switch-text">Kích hoạt tính năng trợ lý AI toàn hệ thống</span>
              </label>
              <span className="switch-help">Nếu tắt, sinh viên và giảng viên sẽ không thể sử dụng tính năng hỏi đáp và sinh bản nháp AI.</span>
            </div>

            <div className="quota-row-2col">
              <TextField
                label="Hạn mức AI Giảng viên (lượt / ngày)"
                required
                type="number"
                min="1"
                value={teacherQuota}
                onChange={e => setTeacherQuota(e.target.value)}
                disabled={!enableAi}
              />

              <TextField
                label="Hạn mức AI Sinh viên (lượt / ngày)"
                required
                type="number"
                min="1"
                value={studentQuota}
                onChange={e => setStudentQuota(e.target.value)}
                disabled={!enableAi}
              />
            </div>
          </div>
        </section>

        {/* SECTION 3: SIMULATED EMAIL SETTINGS */}
        <section className="settings-card">
          <div className="card-top-header">
            <Mail size={22} className="card-icon orange" />
            <div>
              <h2 className="card-title">3. Dịch vụ gửi Email mô phỏng</h2>
              <p className="card-subtitle">Mô phỏng gửi thông báo đến hòm thư sinh viên và cán bộ.</p>
            </div>
          </div>

          <div className="card-fields-grid">
            <div className="switch-row-box">
              <label className="switch-toggle-label">
                <input
                  type="checkbox"
                  checked={enableEmail}
                  onChange={e => setEnableEmail(e.target.checked)}
                />
                <span className="switch-text">Bật mô phỏng gửi thông báo qua Email</span>
              </label>
              <span className="switch-help">Tác vụ gửi email chạy trong môi trường demo an toàn, không gửi email rác ra mạng bên ngoài.</span>
            </div>
          </div>
        </section>

        {/* SECTION 4: SECURITY SCAN POLICY (NON-TOGGLEABLE) */}
        <section className="settings-card security-policy-card">
          <div className="card-top-header">
            <ShieldCheck size={22} className="card-icon green" />
            <div>
              <h2 className="card-title">4. Chính sách quét an ninh & Mã độc</h2>
              <p className="card-subtitle">Quy định bắt buộc theo tiêu chuẩn bảo mật dữ liệu NPC LMS.</p>
            </div>
          </div>

          <div className="security-enforced-banner">
            <div className="enforced-left">
              <span className="enforced-badge">CHÍNH SÁCH BẮT BUỘC BẬT (ENFORCED)</span>
              <p className="enforced-desc">
                Tính năng tự động quét an ninh mã độc cho 100% học liệu và bài nộp sinh viên luôn được kích hoạt ở mức cao nhất. Không thể tắt tính năng này để bảo vệ an toàn máy chủ và dữ liệu người dùng.
              </p>
            </div>
          </div>
        </section>

        {/* Save Bar */}
        <div className="settings-submit-bar">
          <Button type="submit" variant="primary">
            <Save size={16} />
            <span>Lưu cấu hình hệ thống</span>
          </Button>
        </div>
      </form>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <Modal
          title="Xác nhận lưu cấu hình hệ thống"
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn chuẩn bị cập nhật các tham số vận hành toàn trường. Các thay đổi này sẽ có hiệu lực ngay lập tức cho toàn bộ người dùng.
            </p>
            <div className="confirm-summary-list">
              <div>Định dạng cho phép: <strong>{formatsStr}</strong></div>
              <div>Dung lượng tối đa: <strong>{maxSizeMb} MB</strong></div>
              <div>Trợ lý AI: <strong>{enableAi ? 'BẬT' : 'TẮT'}</strong></div>
              <div>Email mô phỏng: <strong>{enableEmail ? 'BẬT' : 'TẮT'}</strong></div>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowConfirmModal(false)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isSaving}
                onClick={handleConfirmSave}
              >
                Xác nhận lưu cấu hình
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
