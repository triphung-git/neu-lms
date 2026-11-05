import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../../../api/client';
import { filesService } from '../../../api/filesService';
import type { components } from '../../../api/schema';
import { SubmissionGradePanel } from './SubmissionGradePanel';
import './TeacherSubmissionsPage.css';
import { SubmissionHistory } from './SubmissionHistory';

type Listing = components['schemas']['TeacherSubmissionList'];

export function TeacherSubmissionList() {
  const { baiTapId } = useParams();

  if (!baiTapId) return <p role="alert">{uiText("Thiếu mã bài tập.")}</p>;

  return <List key={baiTapId} id={baiTapId} />;
}

function List({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setData(null);

    apiClient.untypedRequest<Listing>(
      `/api/v1/assignments/${encodeURIComponent(id)}/submissions`,
      { method: 'GET', params: { page }, signal: controller.signal },
    ).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(err => {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : uiText("Không tải được bài nộp."));
      }
    });

    return () => controller.abort();
  }, [id, page, retry]);

  if (error) {
    return (
      <div role="alert">
        <p>{error}</p>
        <button onClick={() => setRetry(n => n + 1)}>{uiText("Thử lại")}</button>
      </div>
    );
  }

  if (!data) return <p role="status">{uiText("Đang tải danh sách bài nộp…")}</p>;

  return (
    <section className="teacher-subs-container teacher-submission-list">
      <Link to={`/gv/mon-hoc/${data.course_id}/bai-tap`}>
        {uiText("← Danh sách bài tập")}</Link>

      <h1>{uiText("Bài nộp · ")}{data.title}</h1>
      <p>{data.pagination.total_items} {uiText(" sinh viên đã nộp")}</p>

      {data.items.length === 0 ? (
        <p>{uiText("Chưa có sinh viên nộp bài.")}</p>
      ) : (
        <div
        className="workflow-table-wrap"
        role="region"
        aria-label={uiText("Danh sách bài nộp")}
        tabIndex={0}
        > 
        <table>
          <thead>
            <tr>
                <th>{uiText("Sinh viên")}</th>
                <th>{uiText("Lần nộp")}</th>
                <th>{uiText("Thời điểm")}</th>
                <th>{uiText("Trạng thái")}</th>
                <th>{uiText("Tệp")}</th>
                <th>{uiText("Chấm điểm")}</th>
            </tr>
          </thead>

          <tbody>
            {data.items.map(row => (
              <tr key={row.id}>
                <td>
                  {row.student_name}
                  <br />
                  {row.student_email}
                </td>
                <td>
                    <strong>{uiText("Lần ")}{row.number}</strong>
                    <SubmissionHistory
                    courseId={data.course_id}
                    assignmentId={id}
                    studentId={row.student_id}
                    />
                </td>
                <td>{new Date(row.submitted_at).toLocaleString(currentLocale())}</td>
                <td>{row.is_late ? uiText("Nộp muộn") : uiText("Đúng hạn")}</td>
                <td>
                  <a href={filesService.getDownloadUrl(data.course_id, row.file_id)}>
                    {row.file_name}
                  </a>
                </td>
                <td>
                  <div className="teacher-submission-grade-actions">
                    <SubmissionGradePanel submissionId={row.id} editable />
                    <Link to={`/gv/bai-nop/${row.id}/cham`}>
                      {uiText("Mở phiếu chấm riêng")}</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {data.pagination.total_pages > 1 && (
        <nav aria-label={uiText("Phân trang bài nộp")}>
          <button
            disabled={!data.pagination.has_previous}
            onClick={() => setPage(page - 1)}
          >
            {uiText("Trước")}</button>
          {' '}Trang {page}/{data.pagination.total_pages}{' '}
          <button
            disabled={!data.pagination.has_next}
            onClick={() => setPage(page + 1)}
          >
            Sau
          </button>
        </nav>
      )}
    </section>
  );
}