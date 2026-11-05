import {uiText} from "../../../shared/i18n/translate";
import type { FC } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SubmissionGradePanel } from '../../submissions/pages/SubmissionGradePanel';
import './TeacherGradingPage.css';

/**
 * Server-backed grading route for a single submission revision.
 * Authorization, rubric validation, optimistic version checks and grade
 * publication are enforced by /api/v1/submissions/{id}/grade.
 */
export const TeacherGradingPage: FC = () => {
  const { baiNopId } = useParams<{ baiNopId: string }>();

  if (!baiNopId) {
    return (
      <div className="teacher-grading-container">
        <p role="alert">{uiText("Thiếu mã bài nộp.")}</p>
        <Link to="/gv">{uiText("Về bàn làm việc")}</Link>
      </div>
    );
  }

  return (
    <main className="teacher-grading-container" data-testid="teacher-grading-page">
      <header className="teacher-grading-page-header">
        <div>
          <Link to="/gv">{uiText("← Bàn làm việc")}</Link>
          <h1 className="grading-main-heading">{uiText("Chấm bài nộp")}</h1>
          <p>
            {uiText("Điểm, rubric và nhận xét được lưu trực tiếp trên máy chủ. Sinh viên chỉ nhìn thấy phiên bản đã được giảng viên công bố.")}</p>
        </div>
      </header>

      <section className="grading-workstation-grid" aria-label={uiText("Phiếu chấm điểm")}>
        <div className="rubric-scoring-panel">
          <SubmissionGradePanel submissionId={baiNopId} editable />
        </div>
      </section>
    </main>
  );
};
