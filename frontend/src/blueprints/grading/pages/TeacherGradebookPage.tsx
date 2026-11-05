import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../../../api/client';
import './TeacherGradebookPage.css';

type Grade = {
  score: string;
  status: 'draft' | 'published';
};

type Result = {
  course_name: string;
  assignments: { id: string; title: string }[];
  assignment_id: string | null;
  total_score: string | null;
  items: {
    student_id: string;
    name: string;
    email: string;
    revision_number: number | null;
    latest_grade: Grade | null;
    published_grade: Grade | null;
  }[];
  pagination: {
    page: number;
    total_pages: number;
    total_items: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

export function TeacherGradebookPage() {
  const { monId } = useParams();

  if (!monId) {
    return <p role="alert">{uiText("Thiếu mã môn học.")}</p>;
  }

  return <Gradebook key={monId} courseId={monId} />;
}

function Gradebook({ courseId }: { courseId: string }) {
  const [assignmentId, setAssignmentId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    setData(null);
    setError('');

    apiClient
      .untypedRequest<Result>(
        `/api/v1/courses/${courseId}/gradebook`,
        {
          params: {
            page,
            ...(assignmentId ? { assignment_id: assignmentId } : {}),
            ...(search ? { search } : {}),
          },
          signal: controller.signal,
        },
      )
      .then(result => {
        if (controller.signal.aborted) return;

        setData(result);

        if (!assignmentId && result.assignment_id) {
          setAssignmentId(result.assignment_id);
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
  }, [courseId, assignmentId, page, reload, search]);

  const exportParams = new URLSearchParams({ download: 'csv' });

  if (data?.assignment_id) {
    exportParams.set('assignment_id', data.assignment_id);
  }

  if (search) {
    exportParams.set('search', search);
  }

  return (
    <section className="live-gradebook">
      <h1>{uiText("Bảng điểm môn học")}</h1>
      <p>{data?.course_name}</p>
      <p>
        {uiText("Danh sách sinh viên đang tham gia; kết quả theo lần nộp mới nhất.")}</p>

      <button
        type="button"
        onClick={() => setReload(value => value + 1)}
      >
        {uiText("Cập nhật bảng điểm")}</button>

      <form
        className="gradebook-search"
        role="search"
        onSubmit={event => {
          event.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <label>
          {uiText("Tìm sinh viên theo tên hoặc email")}<input
            type="search"
            value={searchInput}
            maxLength={120}
            placeholder={uiText("Ví dụ: Quang hoặc một phần email")}
            onChange={event => setSearchInput(event.target.value)}
          />
        </label>
        
        <button type="submit">{uiText("Tìm")}</button>
        
        <button
          type="button"
          disabled={!search && !searchInput}
          onClick={() => {
            setSearchInput('');
            setSearch('');
            setPage(1);
          }}
        >
          {uiText("Xóa bộ lọc")}</button>
      </form>

      {error && <p role="alert">{error}</p>}

      {!data && !error && (
        <p role="status">{uiText("Đang tải bảng điểm…")}</p>
      )}

      {data && (
        data.assignments.length === 0 ? (
          <p>{uiText("Chưa có bài tập được công bố.")}</p>
        ) : (
          <>
            <div className="live-gradebook-toolbar">
              <label>
                {uiText("Bài tập")}<select
                  value={data.assignment_id ?? ''}
                  onChange={event => {
                    setAssignmentId(event.target.value);
                    setPage(1);
                  }}
                >
                  {data.assignments.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>

              <Link
                to={`/gv/bai-tap/${data.assignment_id}/bai-nop`}
              >
                {uiText("Mở bài nộp để chấm")}</Link>
              {data.assignment_id && data.pagination.total_items > 0 && (
                <a
                  className="gradebook-export"
                  href={`/api/v1/courses/${courseId}/gradebook?${exportParams.toString()}`}
                  download
                >
                  {uiText("Xuất CSV (")}{data.pagination.total_items} {uiText(" sinh viên)")}</a>
              )}
            </div>

            <p>
              {data.pagination.total_items} {uiText(" sinh viên")}{' '}{uiText("· Thang điểm: ")}{data.total_score}
            </p>

            <div
              className="live-gradebook-table"
              tabIndex={0}
              role="region"
              aria-label={uiText("Bảng điểm sinh viên")}
            >
              <table>
                <thead>
                  <tr>
                    <th>{uiText("Sinh viên")}</th>
                    <th>{uiText("Lần nộp")}</th>
                    <th>{uiText("Bản chấm mới nhất")}</th>
                    <th>{uiText("Điểm sinh viên đang thấy")}</th>
                  </tr>
                </thead>

                <tbody>
                  {data.items.map(row => (
                    <tr key={row.student_id}>
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.email}</small>
                      </td>

                      <td>
                        {row.revision_number ?? uiText("Chưa nộp")}
                      </td>

                      <td>
                        {row.latest_grade ? (
                          <span
                            className={
                              `grade-state ` +
                              `grade-state-${row.latest_grade.status}`
                            }
                          >
                            {row.latest_grade.score}/{data.total_score}
                            {' '}·{' '}
                            {row.latest_grade.status === 'draft'
                              ? uiText("Nháp")
                              : uiText("Đã công bố")}
                          </span>
                        ) : (
                          row.revision_number === null
                            ? '—'
                            : uiText("Chưa chấm")
                        )}
                      </td>

                      <td>
                        {row.published_grade
                          ? `${row.published_grade.score}/${data.total_score}`
                          : uiText("Chưa có")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.items.length === 0 && (
              <p role="status">
                {search
                ? uiText("Không có sinh viên khớp với “{0}”.",[search])
                : uiText("Môn học chưa có sinh viên đang tham gia.")}
              </p>
            )}

            <nav aria-label={uiText("Phân trang bảng điểm")}>
              <button
                type="button"
                disabled={!data.pagination.has_previous}
                onClick={() => setPage(value => value - 1)}
              >
                {uiText("Trước")}</button>

              <span>
                Trang {data.pagination.page}/
                {data.pagination.total_pages}
              </span>

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
    </section>
  );
}