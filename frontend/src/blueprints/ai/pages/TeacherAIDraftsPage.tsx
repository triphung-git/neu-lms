import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { demoClock } from '../../../shared/kernel/clock';
import { AIDraft } from '../../../shared/kernel/types';
import {
  Sparkles,
  FileText,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Award
} from 'lucide-react';
import './TeacherAIDraftsPage.css';

export const TeacherAIDraftsPage: React.FC = () => {
  const { aiDrafts, courses, materials, updateAIDraft, systemSettings } = useDatabase();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  // Active draft for drawer/modal
  const [selectedDraft, setSelectedDraft] = useState<AIDraft | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Filter drafts for courses taught by this teacher
  const teacherCourses = useMemo(() => {
    return courses.filter(c => c.teacherId === currentUser?.id);
  }, [courses, currentUser]);

  const teacherCourseIds = useMemo(() => {
    return new Set(teacherCourses.map(c => c.id));
  }, [teacherCourses]);

  const myDrafts = useMemo(() => {
    return aiDrafts
      .filter(d => teacherCourseIds.has(d.courseId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [aiDrafts, teacherCourseIds]);

  // Quota usage simulation
  const usedToday = myDrafts.filter(d => {
    const dDate = new Date(d.createdAt).toDateString();
    return dDate === new Date().toDateString();
  }).length;

  const handleOpenDraft = (draft: AIDraft) => {
    setSelectedDraft(draft);
    setEditedContent(draft.text || draft.structuredContent?.instructions || draft.title || '');
  };

  const handleAcceptSummary = () => {
    if (!selectedDraft) return;
    setIsUpdating(true);

    const res = updateAIDraft(selectedDraft.id, {
      text: editedContent.trim(),
      status: 'confirmed',
      confirmedAt: demoClock.now(),
      confirmedBy: currentUser?.id
    });

    setIsUpdating(false);
    setSelectedDraft(null);

    if (res.ok) {
      showNotification('success', 'Đã phê duyệt và lưu tóm tắt vào học liệu chính thức.');
    } else {
      showNotification('error', res.error?.message || 'Lỗi cập nhật');
    }
  };

  const handleUseInAssignment = () => {
    if (!selectedDraft) return;
    updateAIDraft(selectedDraft.id, {
      text: editedContent.trim(),
      status: 'confirmed',
      confirmedAt: demoClock.now(),
      confirmedBy: currentUser?.id
    });
    setSelectedDraft(null);
    showNotification('success', 'Đang chuyển nội dung đề xuất sang biểu mẫu soạn thảo bài tập...');
    navigate(`/gv/mon-hoc/${selectedDraft.courseId}/bai-tap/soan`);
  };

  const handleRejectDraft = () => {
    if (!selectedDraft) return;
    const res = updateAIDraft(selectedDraft.id, { status: 'discarded' });
    setSelectedDraft(null);
    if (res.ok) {
      showNotification('info', 'Đã hủy bản nháp AI.');
    }
  };

  return (
    <div className="teacher-ai-drafts-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/gv' },
            { label: 'Bản nháp AI & Trợ lý học vụ' }
          ]}
        />
        <h1 className="page-heading">Bản nháp AI & Hỗ trợ giảng dạy</h1>
        <p className="page-subheading">
          Xem xét, tinh chỉnh và phê duyệt các tóm tắt học liệu hoặc đề xuất bài tập do trợ lý AI sinh tự động.
        </p>
      </div>

      {/* Quota & Status Card */}
      <div className="quota-summary-banner">
        <div className="quota-left">
          <div className="sparkles-icon-wrap">
            <Sparkles size={24} />
          </div>
          <div>
            <h2 className="quota-title">Hạn mức sử dụng AI giảng viên</h2>
            <p className="quota-subtitle">
              Tính năng AI hỗ trợ tóm tắt tài liệu và gợi ý đề cương bài tập theo chuẩn đạo đức học thuật.
            </p>
          </div>
        </div>

        <div className="quota-stats-col">
          <div className="quota-meter">
            <span className="quota-val">{usedToday} / {systemSettings.teacherMonthlyAIQuota} lượt</span>
            <span className="quota-lbl">Đã dùng tháng này</span>
          </div>
          <span className="quota-status-badge">
            {systemSettings.aiEnabled ? 'Đang hoạt động' : 'Tạm dừng toàn cục'}
          </span>
        </div>
      </div>

      {/* Drafts List */}
      <section className="drafts-table-section">
        <h2 className="section-title">Danh sách bản nháp cần duyệt ({myDrafts.length})</h2>

        {myDrafts.length === 0 ? (
          <EmptyState
            title="Chưa có bản nháp AI nào"
            description="Bạn có thể yêu cầu tạo bản nháp tóm tắt từ màn hình chi tiết học liệu (T09) hoặc gợi ý rubric khi soạn bài tập (T11)."
          />
        ) : (
          <div className="drafts-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Loại bản nháp</th>
                  <th>Nguồn học liệu / Học phần</th>
                  <th>Phiên bản</th>
                  <th>Thời điểm tạo</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {myDrafts.map(d => {
                  const c = courses.find(crs => crs.id === d.courseId);
                  return (
                    <tr key={d.id}>
                      <td>
                        <div className="draft-type-cell">
                          {d.type === 'summary' ? (
                            <FileText size={16} className="type-icon blue" />
                          ) : (
                            <Award size={16} className="type-icon orange" />
                          )}
                          <strong>{d.type === 'summary' ? 'Tóm tắt học liệu' : 'Đề xuất bài tập'}</strong>
                        </div>
                      </td>
                      <td>
                        <strong>{d.title || (d.type === 'summary' ? 'Tóm tắt học liệu' : 'Đề xuất bài tập')}</strong>
                        <div className="table-subtext">{c?.name} ({c?.code})</div>
                      </td>
                      <td>v{d.sourceVersionIds?.[0] || '1'}</td>
                      <td>{formatDateVN(d.createdAt)}</td>
                      <td>
                        <Badge
                          variant={d.status === 'confirmed' ? 'published' : d.status === 'discarded' ? 'archived' : 'draft'}
                          label={d.status === 'confirmed' ? 'Đã phê duyệt' : d.status === 'discarded' ? 'Đã hủy' : 'Chờ phê duyệt'}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="npc-btn npc-btn-secondary npc-btn-sm"
                          onClick={() => handleOpenDraft(d)}
                        >
                          <span>Biên tập & Duyệt</span>
                          <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Drawer / Modal Edit Draft */}
      {selectedDraft && (
        <Modal
          title={selectedDraft.type === 'summary' ? 'Biên tập & Phê duyệt Tóm tắt AI' : 'Biên tập Đề xuất bài tập'}
          isOpen={!!selectedDraft}
          onClose={() => setSelectedDraft(null)}
        >
          <div className="draft-edit-modal-stack">
            <div className="draft-source-banner">
              <span>Học phần: <strong>{courses.find(c => c.id === selectedDraft.courseId)?.name}</strong></span>
              <span className="dot">•</span>
              <span>Bản nháp: <strong>{selectedDraft.title || 'Đề xuất AI'}</strong></span>
            </div>

            <TextAreaField
              label="Nội dung bản nháp (Giảng viên có thể chỉnh sửa trước khi xác nhận)"
              value={editedContent}
              onChange={e => setEditedContent(e.target.value)}
              rows={10}
            />

            <div className="modal-actions-bar">
              <Button type="button" variant="ghost" onClick={handleRejectDraft}>
                <XCircle size={16} />
                <span>Từ chối / Hủy bản nháp</span>
              </Button>

              <Button type="button" variant="secondary" onClick={() => setSelectedDraft(null)}>
                Đóng
              </Button>

              {selectedDraft.type === 'summary' ? (
                <Button
                  type="button"
                  variant="primary"
                  isLoading={isUpdating}
                  onClick={handleAcceptSummary}
                  disabled={selectedDraft.status === 'confirmed'}
                >
                  <CheckCircle2 size={16} />
                  <span>{selectedDraft.status === 'confirmed' ? 'Đã phê duyệt' : 'Xác nhận & Lưu vào học liệu'}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleUseInAssignment}
                >
                  <ArrowRight size={16} />
                  <span>Sử dụng làm bài tập mới</span>
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
