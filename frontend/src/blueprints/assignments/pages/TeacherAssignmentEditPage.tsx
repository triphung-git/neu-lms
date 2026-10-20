import React, { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField, TextAreaField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Modal } from '../../../shared/ui/Modal';
import { Badge } from '../../../shared/ui/Badge';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatScoreVN } from '../../../shared/kernel/formatting';
import { RubricCriterion } from '../../../shared/kernel/types';
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
  Lock
} from 'lucide-react';
import './TeacherAssignmentEditPage.css';

export const TeacherAssignmentEditPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [searchParams] = useSearchParams();
  const { courses, assignments, aiDrafts, createAssignment, updateAssignment } = useDatabase();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const editAssignmentId = searchParams.get('baiTap');
  const course = courses.find(c => c.id === monId);
  const isArchived = course?.status === 'archived';

  const existingAssignment = editAssignmentId
    ? assignments.find(a => a.id === editAssignmentId)
    : null;

  const isAlreadyPublished = existingAssignment?.status === 'published';

  // Tabs: 'soan' vs 'xem-truoc'
  const [activeTab, setActiveTab] = useState<'soan' | 'xem-truoc'>('soan');

  // Form Fields
  const [title, setTitle] = useState(existingAssignment?.title || '');
  const [description, setDescription] = useState(existingAssignment?.instructions || '');
  const [dueDateStr, setDueDateStr] = useState(
    existingAssignment ? existingAssignment.dueAt.split('T')[0] : '2026-10-25'
  );
  const [dueTimeStr, setDueTimeStr] = useState(
    existingAssignment && existingAssignment.dueAt.includes('T')
      ? existingAssignment.dueAt.split('T')[1].substring(0, 5)
      : '23:59'
  );
  const [allowLate, setAllowLate] = useState(existingAssignment?.allowLate ?? false);

  // Rubric
  const [rubricItems, setRubricItems] = useState<RubricCriterion[]>(
    existingAssignment?.rubricCriteria || [
      { id: 'cr-1', title: 'Tính đúng đắn và đầy đủ chức năng', maxScore: 5, description: 'Hoàn thành toàn bộ ca kiểm thử chức năng' },
      { id: 'cr-2', title: 'Kiến trúc mã nguồn và phong cách viết', maxScore: 3, description: 'Phân tách module rõ ràng, clean code' },
      { id: 'cr-3', title: 'Tài liệu hướng dẫn và báo cáo kiểm thử', maxScore: 2, description: 'Tài liệu Markdown chuẩn, bằng chứng kết quả' }
    ]
  );

  // AI Drawer state
  const [showAiDrawer, setShowAiDrawer] = useState(false);

  // Publish Confirm Modal
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate total score from rubric
  const totalScore = useMemo(() => {
    return rubricItems.reduce((acc, item) => acc + (Number(item.maxScore) || 0), 0);
  }, [rubricItems]);

  if (!course) {
    return (
      <div className="teacher-ass-edit-container">
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

  // RUBRIC HANDLERS
  const handleAddCriterion = () => {
    const newItem: RubricCriterion = {
      id: `cr-${Date.now()}`,
      title: 'Tiêu chí đánh giá mới',
      maxScore: 1,
      description: 'Mô tả yêu cầu đạt điểm tối đa'
    };
    setRubricItems(prev => [...prev, newItem]);
  };

  const handleUpdateCriterion = (id: string, updates: Partial<RubricCriterion>) => {
    setRubricItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleDeleteCriterion = (id: string) => {
    if (rubricItems.length <= 1) {
      showNotification('error', 'Bài tập phải có ít nhất một tiêu chí chấm điểm trong rubric.');
      return;
    }
    setRubricItems(prev => prev.filter(item => item.id !== id));
  };

  const handleMoveCriterion = (index: number, dir: 'up' | 'down') => {
    const targetIdx = dir === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= rubricItems.length) return;

    const list = [...rubricItems];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    setRubricItems(list);
  };

  // AI DRAWER APPLY
  const handleApplyAiRubric = () => {
    const suggested: RubricCriterion[] = [
      { id: `ai-cr-1`, title: 'Chức năng và đáp ứng yêu cầu nghiệp vụ', maxScore: 4, description: 'Thực thi chính xác theo đặc tả kỹ thuật' },
      { id: `ai-cr-2`, title: 'Chất lượng kiến trúc và khả năng kiểm thử', maxScore: 3, description: 'Mã nguồn tường minh, có unit test bao phủ' },
      { id: `ai-cr-3`, title: 'Trải nghiệm người dùng và chuẩn Accessibility', maxScore: 2, description: 'Tương tác mượt mà, hỗ trợ bàn phím WCAG' },
      { id: `ai-cr-4`, title: 'Báo cáo kỹ thuật và kiểm soát lỗi', maxScore: 1, description: 'Ghi nhật ký đầy đủ, xử lý ngoại lệ an toàn' }
    ];
    setRubricItems(suggested);
    setShowAiDrawer(false);
    showNotification('success', 'Đã áp dụng bộ tiêu chí Rubric gợi ý bởi AI vào biểu mẫu soạn thảo.');
  };

  // SAVE AS DRAFT
  const handleSaveDraft = () => {
    if (isArchived) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      showNotification('error', 'Vui lòng nhập tiêu đề bài tập.');
      return;
    }

    const fullDueDate = `${dueDateStr}T${dueTimeStr}:00+07:00`;

    if (existingAssignment) {
      const res = updateAssignment(existingAssignment.id, {
        title: trimmedTitle,
        instructions: description.trim(),
        dueAt: fullDueDate,
        allowLate,
        rubricCriteria: rubricItems,
        maxScore: totalScore
      });
      if (res.ok) {
        showNotification('success', 'Đã lưu bản nháp bài tập thành công.');
        navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
      } else {
        showNotification('error', res.error?.message || 'Lỗi lưu bản nháp');
      }
    } else {
      const newId = `ass-${Date.now()}`;
      const res = createAssignment({
        id: newId,
        courseId: course.id,
        title: trimmedTitle,
        instructions: description.trim(),
        attachments: [],
        dueAt: fullDueDate,
        allowLate,
        maxScore: totalScore,
        rubricCriteria: rubricItems,
        status: 'draft'
      });
      if (res.ok) {
        showNotification('success', 'Đã tạo bản nháp bài tập mới thành công.');
        navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
      } else {
        showNotification('error', res.error?.message || 'Lỗi tạo bài tập');
      }
    }
  };

  // CONFIRM PUBLISH
  const handleConfirmPublish = () => {
    if (isArchived) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      showNotification('error', 'Vui lòng nhập tiêu đề bài tập.');
      return;
    }

    const fullDueDate = `${dueDateStr}T${dueTimeStr}:00+07:00`;
    setIsSubmitting(true);

    if (existingAssignment) {
      const res = updateAssignment(existingAssignment.id, {
        title: isAlreadyPublished ? existingAssignment.title : trimmedTitle,
        instructions: isAlreadyPublished ? existingAssignment.instructions : description.trim(),
        dueAt: fullDueDate,
        allowLate,
        rubricCriteria: isAlreadyPublished ? existingAssignment.rubricCriteria : rubricItems,
        maxScore: isAlreadyPublished ? existingAssignment.maxScore : totalScore,
        status: 'published'
      });
      setIsSubmitting(false);
      setShowPublishModal(false);

      if (res.ok) {
        showNotification('success', `Đã công bố bài tập "${trimmedTitle}" cho sinh viên.`);
        navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
      } else {
        showNotification('error', res.error?.message || 'Lỗi công bố bài tập');
      }
    } else {
      const newId = `ass-${Date.now()}`;
      const res = createAssignment({
        id: newId,
        courseId: course.id,
        title: trimmedTitle,
        instructions: description.trim(),
        attachments: [],
        dueAt: fullDueDate,
        allowLate,
        maxScore: totalScore,
        rubricCriteria: rubricItems,
        status: 'published'
      });
      setIsSubmitting(false);
      setShowPublishModal(false);

      if (res.ok) {
        showNotification('success', `Đã công bố bài tập "${trimmedTitle}" thành công.`);
        navigate(`/gv/mon-hoc/${course.id}/bai-tap`);
      } else {
        showNotification('error', res.error?.message || 'Lỗi công bố bài tập');
      }
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
            { label: existingAssignment ? `Chỉnh sửa: ${existingAssignment.title}` : 'Soạn bài tập mới' }
          ]}
        />
        <div className="title-row">
          <h1 className="edit-main-title">
            {existingAssignment ? `Chỉnh sửa bài tập` : `Soạn bài tập mới`}
          </h1>
          {existingAssignment && (
            <Badge
              variant={existingAssignment.status === 'published' ? 'published' : 'draft'}
              label={existingAssignment.status === 'published' ? 'Đã công bố' : 'Bản nháp'}
            />
          )}
        </div>
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>Môn học đã lưu trữ: Toàn bộ thông tin ở trạng thái chỉ đọc.</span>
        </div>
      )}

      {isAlreadyPublished && (
        <div className="published-lock-alert" role="alert">
          <Lock size={18} />
          <span>
            <strong>Bài tập đã được công bố:</strong> Tiêu đề, đề bài và tiêu chí Rubric được khóa cố định để đảm bảo sự công bằng cho sinh viên đã nộp bài. Bạn chỉ có thể điều chỉnh <strong>Hạn nộp</strong> và <strong>Cho phép nộp muộn</strong>.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="edit-tabs-bar" role="tablist">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'soan' ? 'active' : ''}`}
          onClick={() => setActiveTab('soan')}
        >
          <FileText size={16} />
          <span>Soạn thảo bài tập</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'xem-truoc' ? 'active' : ''}`}
          onClick={() => setActiveTab('xem-truoc')}
        >
          <Eye size={16} />
          <span>Xem trước như sinh viên</span>
        </button>
      </div>

      {/* TAB 1: SOẠN THẢO */}
      {activeTab === 'soan' && (
        <div className="editor-layout">
          <div className="editor-main-form">
            <section className="form-section-card">
              <h2 className="section-title">Thông tin đề bài</h2>
              <div className="fields-stack">
                <TextField
                  label="Tiêu đề bài tập"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ví dụ: Bài tập lớn: Thiết kế hệ thống thông tin"
                  disabled={isAlreadyPublished || isArchived}
                />

                <TextAreaField
                  label="Yêu cầu đề bài & Hướng dẫn sinh viên"
                  required
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Mô tả chi tiết yêu cầu, định dạng nộp bài, các kịch bản cần hiện thực..."
                  rows={6}
                  disabled={isAlreadyPublished || isArchived}
                />

                <div className="form-row-dates">
                  <TextField
                    label="Hạn nộp bài (Ngày)"
                    required
                    type="date"
                    value={dueDateStr}
                    onChange={e => setDueDateStr(e.target.value)}
                    disabled={isArchived}
                  />

                  <TextField
                    label="Giờ chót"
                    required
                    type="time"
                    value={dueTimeStr}
                    onChange={e => setDueTimeStr(e.target.value)}
                    disabled={isArchived}
                  />

                  <div className="checkbox-field-wrap">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={allowLate}
                        onChange={e => setAllowLate(e.target.checked)}
                        disabled={isArchived}
                      />
                      <span>Cho phép nộp muộn sau hạn chót</span>
                    </label>
                    <span className="checkbox-subtext">Sinh viên nộp muộn sẽ được gắn nhãn cảnh báo riêng khi chấm.</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Rubric Builder Section */}
            <section className="form-section-card">
              <div className="rubric-builder-header">
                <div>
                  <h2 className="section-title">Tiêu chí chấm điểm (Rubric)</h2>
                  <p className="section-desc">Thiết lập các tiêu chí cụ thể để chấm điểm minh bạch và chuẩn xác.</p>
                </div>
                <div className="total-score-chip">
                  <span>Tổng điểm: </span>
                  <strong>{totalScore} điểm</strong>
                </div>
              </div>

              {!isAlreadyPublished && !isArchived && (
                <div className="rubric-ai-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAiDrawer(true)}
                  >
                    <Sparkles size={16} />
                    <span>Gợi ý tiêu chí Rubric bằng AI</span>
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
                          onChange={e => handleUpdateCriterion(item.id, { title: e.target.value })}
                          disabled={isAlreadyPublished || isArchived}
                        />
                      </div>
                      <div className="input-pts-col">
                        <TextField
                          label="Điểm tối đa"
                          type="number"
                          value={item.maxScore.toString()}
                          onChange={e => handleUpdateCriterion(item.id, { maxScore: Number(e.target.value) || 0 })}
                          disabled={isAlreadyPublished || isArchived}
                        />
                      </div>
                      <div className="input-desc-col">
                        <TextField
                          label="Mô tả yêu cầu đạt điểm"
                          value={item.description}
                          onChange={e => handleUpdateCriterion(item.id, { description: e.target.value })}
                          disabled={isAlreadyPublished || isArchived}
                        />
                      </div>
                    </div>

                    {!isAlreadyPublished && !isArchived && (
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

              {!isAlreadyPublished && !isArchived && (
                <div className="add-criterion-row">
                  <Button type="button" variant="ghost" onClick={handleAddCriterion}>
                    <Plus size={16} />
                    <span>+ Thêm tiêu chí đánh giá</span>
                  </Button>
                </div>
              )}
            </section>

            {/* Bottom Actions Bar */}
            {!isArchived && (
              <div className="form-bottom-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate(`/gv/mon-hoc/${course.id}/bai-tap`)}
                >
                  Hủy bỏ
                </Button>
                {!isAlreadyPublished && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleSaveDraft}
                  >
                    Lưu bản nháp
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setShowPublishModal(true)}
                >
                  <CheckCircle2 size={16} />
                  <span>{isAlreadyPublished ? 'Lưu cập nhật hạn nộp' : 'Công bố bài tập cho sinh viên'}</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: XEM TRƯỚC NHƯ SINH VIÊN */}
      {activeTab === 'xem-truoc' && (
        <div className="preview-container">
          <div className="preview-watermark-card">
            <span className="preview-badge">GIAO DIỆN XEM TRƯỚC (DÀNH CHO GIẢNG VIÊN KIỂM TRA)</span>
            <h2 className="preview-title">{title || 'Tiêu đề bài tập chưa đặt'}</h2>
            <p className="preview-course-meta">
              Học phần: <strong>{course.name}</strong> • Hạn nộp: <strong>{dueDateStr} {dueTimeStr}</strong>
            </p>

            <hr className="preview-divider" />

            <div className="preview-section">
              <h3>Đề bài & Yêu cầu:</h3>
              <p className="preview-desc-text">
                {description || 'Chưa nhập nội dung hướng dẫn đề bài.'}
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
                  {rubricItems.map(item => (
                    <tr key={item.id}>
                      <td><strong>{item.title}</strong></td>
                      <td>{item.description}</td>
                      <td><strong>{formatScoreVN(item.maxScore)} đ</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Drawer */}
      {showAiDrawer && (
        <Modal
          title="Gợi ý tiêu chí Rubric bằng AI"
          isOpen={showAiDrawer}
          onClose={() => setShowAiDrawer(false)}
        >
          <div className="ai-drawer-content">
            <p className="ai-drawer-intro">
              Dựa trên tiêu đề bài tập <strong>"{title || 'học phần'}"</strong>, hệ thống AI đề xuất bộ tiêu chí đánh giá chuẩn hóa:
            </p>
            <div className="ai-suggested-list">
              <div className="ai-sugg-item">
                <strong>1. Chức năng và đáp ứng yêu cầu (4 đ)</strong>
                <p>Thực thi chính xác theo đặc tả kỹ thuật</p>
              </div>
              <div className="ai-sugg-item">
                <strong>2. Chất lượng kiến trúc và mã nguồn (3 đ)</strong>
                <p>Mã nguồn rõ ràng, phân tách module, có unit test</p>
              </div>
              <div className="ai-sugg-item">
                <strong>3. Trải nghiệm người dùng và tiếp cận a11y (2 đ)</strong>
                <p>Tương tác mượt mà, hỗ trợ điều hướng bàn phím</p>
              </div>
              <div className="ai-sugg-item">
                <strong>4. Báo cáo kỹ thuật và xử lý ngoại lệ (1 đ)</strong>
                <p>Tài liệu hướng dẫn đầy đủ, bắt lỗi an toàn</p>
              </div>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowAiDrawer(false)}>
                Đóng
              </Button>
              <Button type="button" variant="primary" onClick={handleApplyAiRubric}>
                Áp dụng bộ tiêu chí này
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
              <div>Hạn nộp chính thức: <strong>{dueDateStr} lúc {dueTimeStr}</strong></div>
              <div>Cho phép nộp muộn: <strong>{allowLate ? 'Có' : 'Không'}</strong></div>
              <div>Tổng thang điểm: <strong>{totalScore} điểm</strong> ({rubricItems.length} tiêu chí)</div>
            </div>
            <div className="alert-notice-box">
              <CheckCircle2 size={18} />
              <span>
                Lưu ý: Sau khi công bố, tiêu đề và các tiêu chí Rubric sẽ được khóa cố định để đảm bảo sự công bằng cho sinh viên đã làm bài.
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
                onClick={handleConfirmPublish}
              >
                Xác nhận công bố
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
