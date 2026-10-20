import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField, TextAreaField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { Info } from 'lucide-react';
import './CreateCoursePage.css';

export const CreateCoursePage: React.FC = () => {
  const { courses, createCourse } = useDatabase();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [term, setTerm] = useState('HK1-2026');
  const [description, setDescription] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCodeChange = (val: string) => {
    // Force uppercase and remove leading/trailing spaces
    setCode(val.toUpperCase().replace(/\s+/g, ''));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    const trimmedTerm = term.trim();

    if (!trimmedName) {
      setErrorMsg('Vui lòng nhập tên môn học.');
      return;
    }
    if (!trimmedCode) {
      setErrorMsg('Vui lòng nhập mã môn học.');
      return;
    }
    if (!trimmedTerm) {
      setErrorMsg('Vui lòng nhập học kỳ đào tạo.');
      return;
    }

    // Check duplicate code
    const isDuplicate = courses.some(
      c => c.code.toLowerCase() === trimmedCode.toLowerCase()
    );
    if (isDuplicate) {
      setErrorMsg(`Mã môn học "${trimmedCode}" đã tồn tại trên hệ thống. Vui lòng chọn mã khác.`);
      return;
    }

    if (!currentUser) {
      setErrorMsg('Phiên đăng nhập không hợp lệ.');
      return;
    }

    setIsSubmitting(true);
    const newCourseId = `course-${Date.now()}`;
    const result = createCourse({
      id: newCourseId,
      code: trimmedCode,
      name: trimmedName,
      term: trimmedTerm,
      description: description.trim(),
      teacherId: currentUser.id,
      teacherName: currentUser.fullName,
      status: 'open'
    });

    setIsSubmitting(false);

    if (result.ok) {
      showNotification('success', `Đã tạo môn học "${trimmedName}" thành công.`);
      navigate(`/gv/mon-hoc/${newCourseId}`);
    } else {
      setErrorMsg(result.error?.message || 'Không thể tạo môn học.');
    }
  };

  return (
    <div className="create-course-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/gv' },
            { label: 'Môn học của tôi', path: '/gv/mon-hoc' },
            { label: 'Tạo môn học mới' }
          ]}
        />
        <h1 className="page-heading">Tạo môn học mới</h1>
        <p className="page-subheading">
          Khởi tạo môn học mới trong học kỳ. Sau khi tạo, bạn có thể thiết lập đề cương bài học và thêm sinh viên.
        </p>
      </div>

      <div className="create-course-layout">
        <form onSubmit={handleSubmit} className="create-course-form" noValidate>
          {errorMsg && (
            <ErrorBanner
              title="Không thể tạo môn học"
              message={errorMsg}
            />
          )}

          <div className="form-fields-stack">
            <TextField
              label="Tên môn học"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ví dụ: Lập trình Web nâng cao"
              helperText="Tên đầy đủ của học phần theo chương trình đào tạo."
            />

            <div className="form-row-2col">
              <TextField
                label="Mã môn học"
                required
                value={code}
                onChange={e => handleCodeChange(e.target.value)}
                placeholder="Ví dụ: WEB202"
                helperText="Chữ in hoa, không có khoảng trắng. Kiểm tra tự động tính duy nhất."
              />

              <TextField
                label="Học kỳ"
                required
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="Ví dụ: HK1-2026"
                helperText="Học kỳ áp dụng học phần."
              />
            </div>

            <TextAreaField
              label="Mô tả môn học"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Mục tiêu môn học, kiến thức trọng tâm, yêu cầu môn học..."
              rows={4}
            />
          </div>

          <div className="form-actions-bar">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/gv/mon-hoc')}
              disabled={isSubmitting}
            >
              Hủy bỏ
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
            >
              Tạo môn học
            </Button>
          </div>
        </form>

        <aside className="create-course-tips" aria-label="Hướng dẫn thiết lập">
          <div className="tip-box">
            <div className="tip-icon-wrap">
              <Info size={20} />
            </div>
            <div className="tip-content">
              <h3>Quy trình sau khi tạo</h3>
              <ol className="tip-steps-list">
                <li><strong>Cấu trúc môn:</strong> Thêm các chương và bài học trọng tâm.</li>
                <li><strong>Thành viên:</strong> Nhập danh sách email sinh viên được phép vào lớp.</li>
                <li><strong>Học liệu:</strong> Tải lên slide bài giảng, giáo trình PDF.</li>
                <li><strong>Bài tập:</strong> Thiết lập bài tập kèm tiêu chí rubric đánh giá.</li>
              </ol>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
