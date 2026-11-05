import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../../api/client';
import './StudentGradesPage.css';

type Row = {
  assignment_id: string;
  title: string;
  course_id: string;
  course_name: string;
  course_code: string;
  revision_number: number | null;
  total_score: string;
  grade: {
    score: string;
    feedback: string;
    created_at: string;
  } | null;
};

type Listing = {
  items: Row[];
  pagination: {
    page: number;
    total_pages: number;
    total_items: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

export function StudentGradesPage() {
  const [params, setParams] = useSearchParams();
  const courseId = params.get('mon') || '';

  return (
    <Grades
      key={courseId}
      courseId={courseId}
      clearFilter={() => {
        const next = new URLSearchParams(params);
        next.delete('mon');
        setParams(next);
      }}
    />
  );
}

function Grades({
  courseId,
  clearFilter,
}: {
  courseId: string;
  clearFilter: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setData(null);
    setError('');

    apiClient
      .untypedRequest<Listing>('/api/v1/me/grades', {
        params: {
          page,
          ...(courseId ? { course_id: courseId } : {}),
        },
        signal: controller.signal,
      })
      .then(result => {
        if (!controller.signal.aborted) {
          setData(result);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : uiText("Không tải được bảng điểm."),
          );
        }
      });

    return () => controller.abort();
  }, [courseId, page, reload]);

  return (
    <div className="student-grades-page">
      <h1>{uiText("Điểm của tôi")}</h1>

      <p>
        {uiText("Hiển thị kết quả đã công bố của lần nộp mới nhất ở mỗi bài tập.")}</p>

      <div className="grades-toolbar">
        <button
          type="button"
          onClick={() => setReload(value => value + 1)}
        >
          {uiText("Cập nhật bảng điểm")}</button>

        {courseId && (
          <button type="button" onClick={clearFilter}>
            {uiText("Xem tất cả môn")}</button>
        )}
      </div>

      {error && <p role="alert">{error}</p>}

      {!data && !error && (
        <p role="status">{uiText("Đang tải bảng điểm…")}</p>
      )}

      {data && (
        data.items.length === 0 ? (
          <p>
            {uiText("Chưa có bài tập được công bố trong các môn đang tham gia.")}</p>
        ) : (
          <>
            <p>{data.pagination.total_items} {uiText(" bài tập")}</p>

            <div className="grades-table-card" role="region" aria-label={uiText("Bảng điểm")} tabIndex={0}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                }}
              >
                <thead>
                  <tr>
                    <th>{uiText("Môn học")}</th>
                    <th>{uiText("Bài tập")}</th>
                    <th>{uiText("Lần nộp")}</th>
                    <th>{uiText("Điểm")}</th>
                    <th>{uiText("Nhận xét")}</th>
                    <th>{uiText("Công bố lúc")}</th>
                  </tr>
                </thead>

                <tbody>
                  {data.items.map(row => (
                    <tr key={row.assignment_id}>
                      <td style={{ padding: 12 }}>
                        <Link to={`/sv/diem?mon=${row.course_id}`}>
                          {row.course_code} · {row.course_name}
                        </Link>
                      </td>

                      <td style={{ padding: 12 }}>
                        <Link
                          to={
                            `/sv/mon-hoc/${row.course_id}` +
                            `/bai-tap/${row.assignment_id}`
                          }
                        >
                          {row.title}
                        </Link>
                      </td>

                      <td>
                        {row.revision_number ?? uiText("Chưa nộp")}
                      </td>

                      <td>
                        {row.grade
                          ? `${row.grade.score}/${row.total_score}`
                          : row.revision_number === null
                            ? '—'
                            : uiText("Chưa công bố điểm")}
                      </td>

                      <td
                        style={{
                          padding: 12,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {row.grade?.feedback || '—'}
                      </td>

                      <td>
                        {row.grade
                          ? new Date(
                              row.grade.created_at,
                            ).toLocaleString(currentLocale())
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav aria-label={uiText("Phân trang bảng điểm")}>
              <button
                type="button"
                disabled={!data.pagination.has_previous}
                onClick={() => setPage(value => value - 1)}
              >
                {uiText("Trước")}</button>

              {' '}Trang {data.pagination.page}/
              {data.pagination.total_pages}{' '}

              <button
                type="button"
                disabled={!data.pagination.has_next}
                onClick={() => setPage(value => value + 1)}
              >
                Sau
              </button>
            </nav>
          </>
        )
      )}
    </div>
  );
}