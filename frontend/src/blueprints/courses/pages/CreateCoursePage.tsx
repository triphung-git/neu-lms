import {uiText} from "../../../shared/i18n/translate";
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { coursesService } from '../../../api/coursesService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField, TextAreaField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { Info } from 'lucide-react';
import './CreateCoursePage.css';

export const CreateCoursePage: React.FC = () => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    const trimmedTerm = term.trim();

    if (!trimmedName) {
      setErrorMsg(uiText("Vui lòng nhập tên môn học."));
      return;
    }
    if (!trimmedCode) {
      setErrorMsg(uiText("Vui lòng nhập mã môn học."));
      return;
    }
    if (!trimmedTerm) {
      setErrorMsg(uiText("Vui lòng nhập học kỳ đào tạo."));
      return;
    }

    setIsSubmitting(true);
    try {
      const course = await coursesService.create({
        code: trimmedCode,
        name: trimmedName,
        term: trimmedTerm,
        description: description.trim(),
      });
      showNotification('success', uiText("Đã tạo môn học \"{0}\" thành công.",[trimmedName]));
      navigate(`/gv/mon-hoc/${course.id}`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : uiText("Không thể tạo môn học."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="create-course-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: uiText("Bàn làm việc"), path: '/gv' },
            { label: uiText("Môn học của tôi"), path: '/gv/mon-hoc' },
            { label: uiText("Tạo môn học mới") }
          ]}
        />
        <h1 className="page-heading">{uiText("Tạo môn học mới")}</h1>
        <p className="page-subheading">
          {uiText("Khởi tạo môn học mới trong học kỳ. Sau khi tạo, bạn có thể thiết lập đề cương bài học và thêm sinh viên.")}</p>
      </div>

      <div className="create-course-layout">
        <form onSubmit={handleSubmit} className="create-course-form" noValidate>
          {errorMsg && (
            <ErrorBanner
              title={uiText("Không thể tạo môn học")}
              message={errorMsg}
            />
          )}

          <div className="form-fields-stack">
            <TextField
              label={uiText("Tên môn học")}
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={uiText("Ví dụ: Lập trình Web nâng cao")}
              helperText="Tên đầy đủ của học phần theo chương trình đào tạo."
            />

            <div className="form-row-2col">
              <TextField
                label={uiText("Mã môn học")}
                required
                value={code}
                onChange={e => handleCodeChange(e.target.value)}
                placeholder={uiText("Ví dụ: WEB202")}
                helperText="Chữ in hoa, không có khoảng trắng. Kiểm tra tự động tính duy nhất."
              />

              <TextField
                label={uiText("Học kỳ")}
                required
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder={uiText("Ví dụ: HK1-2026")}
                helperText="Học kỳ áp dụng học phần."
              />
            </div>

            <TextAreaField
              label={uiText("Mô tả môn học")}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={uiText("Mục tiêu môn học, kiến thức trọng tâm, yêu cầu môn học...")}
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
              {uiText("Hủy bỏ")}</Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
            >
              {uiText("Tạo môn học")}</Button>
          </div>
        </form>

        <aside className="create-course-tips" aria-label={uiText("Hướng dẫn thiết lập")}>
          <div className="tip-box">
            <div className="tip-icon-wrap">
              <Info size={20} />
            </div>
            <div className="tip-content">
              <h3>{uiText("Quy trình sau khi tạo")}</h3>
              <ol className="tip-steps-list">
                <li><strong>{uiText("Cấu trúc môn:")}</strong> {uiText(" Thêm các chương và bài học trọng tâm.")}</li>
                <li><strong>{uiText("Thành viên:")}</strong> {uiText(" Nhập danh sách email sinh viên được phép vào lớp.")}</li>
                <li><strong>{uiText("Học liệu:")}</strong> {uiText(" Tải lên slide bài giảng, giáo trình PDF.")}</li>
                <li><strong>{uiText("Bài tập:")}</strong> {uiText(" Thiết lập bài tập kèm tiêu chí rubric đánh giá.")}</li>
              </ol>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
