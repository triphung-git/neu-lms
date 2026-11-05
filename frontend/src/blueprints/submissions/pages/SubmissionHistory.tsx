import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { apiClient } from '../../../api/client';
import { filesService } from '../../../api/filesService';
import { Modal } from '../../../shared/ui/Modal';
import { SubmissionGradePanel } from './SubmissionGradePanel';
import './SubmissionHistory.css';

type Props = {
  courseId: string;
  assignmentId: string;
  studentId?: string;
};

type Listing = {
  items: {
    id: number;
    number: number;
    file_id: string;
    file_name: string;
    file_size: number;
    submitted_at: string;
    is_late: boolean;
  }[];
  pagination: {
    page: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

export function SubmissionHistory(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="submission-history-trigger"
        onClick={() => setOpen(true)}
      >
        {uiText("Lịch sử các lần nộp")}</button>

      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(false)}
          title={uiText("Lịch sử các lần nộp bài")}
          size="lg"
        >
          <HistoryContent {...props} />
        </Modal>
      )}
    </>
  );
}

function HistoryContent({ courseId, assignmentId, studentId }: Props) {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    setData(null);
    setSelected(null);
    setError('');

    apiClient
      .untypedRequest<Listing>(
        `/api/v1/courses/${courseId}/assignments/${assignmentId}/submission-history`,
        {
          params: {
            page,
            ...(studentId ? { student_id: studentId } : {}),
          },
          signal: controller.signal,
        },
      )
      .then(result => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : uiText("Không tải được lịch sử."),
          );
        }
      });

    return () => controller.abort();
  }, [courseId, assignmentId, studentId, page, reload]);

  return (
    <div className="submission-history">
      <p>{uiText("Mỗi lần nộp giữ tệp và kết quả chấm riêng.")}</p>

      <button type="button" onClick={() => setReload(value => value + 1)}>
        {uiText("Cập nhật lịch sử")}</button>

      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">{uiText("Đang tải các lần nộp…")}</p>}

      {data && (
        <>
          {data.items.length === 0 && <p>{uiText("Chưa có bài nộp.")}</p>}

          <ol className="submission-history-list">
            {data.items.map(item => (
              <li key={item.id}>
                <div className="submission-history-heading">
                  <strong>{uiText("Lần nộp ")}{item.number}</strong>
                  <span
                    className={item.is_late ? 'submission-late' : 'submission-on-time'}
                  >
                    {item.is_late ? uiText("Nộp muộn") : uiText("Đúng hạn")}
                  </span>
                </div>

                <time dateTime={item.submitted_at}>
                  {new Date(item.submitted_at).toLocaleString(currentLocale())}
                </time>

                <a href={filesService.getDownloadUrl(courseId, item.file_id)}>
                  {item.file_name}
                </a>

                <small>
                  {(item.file_size / 1024).toLocaleString(currentLocale(), {
                    maximumFractionDigits: 1,
                  })} KB
                </small>

                <button
                  type="button"
                  aria-expanded={selected === item.id}
                  onClick={() =>
                    setSelected(value => value === item.id ? null : item.id)
                  }
                >
                  {selected === item.id
                    ? uiText("Ẩn điểm")
                    : studentId
                      ? uiText("Xem / chấm lần nộp này")
                      : uiText("Xem điểm lần nộp này")}
                </button>

                {selected === item.id && (
                  <SubmissionGradePanel
                    submissionId={item.id}
                    editable={Boolean(studentId)}
                  />
                )}
              </li>
            ))}
          </ol>

          {data.pagination.total_pages > 1 && (
            <nav aria-label={uiText("Phân trang các lần nộp")}>
              <button
                type="button"
                disabled={!data.pagination.has_previous}
                onClick={() => setPage(value => value - 1)}
              >
                {uiText("Trước")}</button>

              <span>
                Trang {data.pagination.page}/{data.pagination.total_pages}
              </span>

              <button
                type="button"
                disabled={!data.pagination.has_next}
                onClick={() => setPage(value => value + 1)}
              >
                Sau
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}