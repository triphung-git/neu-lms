import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../../api/client';
import { useSession } from '../../../app/providers/SessionContext';
import { GradeNotices } from './GradeNotices';
import { refreshGradeBadge } from '../useUnreadGradeCount';
import './CourseAnnouncements.css';

type Notice = {
  id: number;
  course_id: string;
  course_name: string;
  author_name: string;
  title: string;
  body: string;
  published_at: string;
  is_read: boolean;
  recipients: number;
};

type Feed = {
  items: Notice[];
  courses: { id: string; name: string; status: string }[];
  pagination: {
    page: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

export function TeacherAnnouncementsPage() {
  const { currentUser } = useSession();
  if (!currentUser) return null;

  return <CourseFeed key={currentUser.id} teacher />;
}

export function StudentAnnouncementsPage() {
  const { currentUser } = useSession();
  if (!currentUser) return null;

  return (
    <>
      <GradeNotices key={currentUser.id} />
      <CourseFeed key={`course-${currentUser.id}`} teacher={false} />
    </>
  );
}

function CourseFeed({ teacher }: { teacher: boolean }) {
  const [params, setParams] = useSearchParams();
  const filter = params.get('mon') || '';

  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const [reload, setReload] = useState(0);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(Number(params.get('thongBao')) || 0);

  const [target, setTarget] = useState(filter);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const url = teacher
    ? '/api/v1/teacher/course-announcements'
    : '/api/v1/me/course-announcements';

  useEffect(() => {
    const controller = new AbortController();
    setFeed(null);
    setError('');

    apiClient.untypedRequest<Feed>(url, {
      params: {
        page,
        ...(filter ? { course_id: filter } : {}),
        ...(unread ? { unread: true } : {}),
      },
      signal: controller.signal,
    })
      .then(result => {
        if (!controller.signal.aborted) setFeed(result);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : uiText("Không tải được thông báo."));
        }
      });

    return () => controller.abort();
  }, [url, filter, page, unread, reload]);

  const openCourses = feed?.courses.filter(course => course.status === 'open') ?? [];
  const courseId = openCourses.some(course => course.id === target)
    ? target
    : openCourses[0]?.id ?? '';

  async function publish() {
    if (busy || !courseId || !title.trim() || !body.trim()) return;

    const courseName = openCourses.find(course => course.id === courseId)?.name;
    if (!window.confirm(uiText("Đăng thông báo lên môn {0}?",[courseName]))) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      await apiClient.untypedRequest(`${url}/publish`, {
        method: 'POST',
        body: {
          course_id: courseId,
          title: title.trim(),
          body: body.trim(),
          request_key: requestKey,
        },
      });

      setTitle('');
      setBody('');
      setRequestKey(crypto.randomUUID());
      setPage(1);
      setParams({ mon: courseId });
      setReload(n => n + 1);
      setMessage(uiText("Đã đăng thông báo."));
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("Không đăng được thông báo."));
    } finally {
      setBusy(false);
    }
  }

  async function markRead(id?: number) {
    if (busy) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const endpoint = id === undefined ? `${url}/read-all` : `${url}/${id}/read`;
      await apiClient.untypedRequest(endpoint, { method: 'POST' });

      if (unread) setPage(1);
      setReload(n => n + 1);
      refreshGradeBadge();

      if (id === undefined) {
        setMessage(uiText("Đã đánh dấu toàn bộ thông báo môn học là đã đọc."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("Không lưu được trạng thái đọc."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="course-feed">
      <h1>{uiText("Thông báo môn học")}</h1>

      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <button
        type="button"
        onClick={() => {
          setPage(1);
          setReload(n => n + 1);
          refreshGradeBadge();
        }}
      >
        {uiText("Làm mới danh sách")}</button>

      {!feed && !error && <p role="status">{uiText("Đang tải…")}</p>}

      {feed && (
        <>
          {teacher && (
            courseId ? (
              <form onSubmit={event => {
                event.preventDefault();
                void publish();
              }}>
                <h2>{uiText("Đăng thông báo trong LMS")}</h2>

                <fieldset disabled={busy}>
                  <label>
                    {uiText("Môn nhận thông báo")}<select value={courseId} onChange={event => {
                      setTarget(event.target.value);
                      setRequestKey(crypto.randomUUID());
                    }}>
                      {openCourses.map(course => (
                        <option key={course.id} value={course.id}>{course.name}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    {uiText("Tiêu đề")}<input required maxLength={200} value={title} onChange={event => {
                      setTitle(event.target.value);
                      setRequestKey(crypto.randomUUID());
                    }} />
                  </label>

                  <label>
                    {uiText("Nội dung")}<textarea required maxLength={10000} rows={4} value={body}
                      onChange={event => {
                        setBody(event.target.value);
                        setRequestKey(crypto.randomUUID());
                      }}
                    />
                  </label>

                  <button type="submit" disabled={!title.trim() || !body.trim()}>
                    {busy ? uiText("Đang lưu…") : uiText("Đăng thông báo")}
                  </button>
                </fieldset>
              </form>
            ) : <p>{uiText("Bạn cần một môn đang mở để đăng thông báo.")}</p>
          )}

          <div className="course-feed-tools">
            <label>
              {uiText("Lọc theo môn")}<select value={filter} onChange={event => {
                setPage(1);
                setExpanded(0);
                setParams(event.target.value ? { mon: event.target.value } : {});
              }}>
                <option value="">{uiText("Tất cả môn")}</option>
                {feed.courses.map(course => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </label>

            {!teacher && (
              <>
                <label>
                  <input type="checkbox" checked={unread} onChange={event => {
                    setUnread(event.target.checked);
                    setPage(1);
                  }} />
                  {uiText("Chỉ hiện chưa đọc")}</label>

                <button type="button" disabled={busy} onClick={() => void markRead()}>
                  {uiText("Đánh dấu đã đọc ở tất cả môn")}</button>
              </>
            )}
          </div>

          {feed.items.length === 0 && <p>{uiText("Không có thông báo trong danh sách này.")}</p>}

          {feed.items.map(notice => (
            <article key={notice.id}>
              <h2>{notice.title}</h2>
              <p>
                {notice.course_name} · {notice.author_name} ·{' '}
                {new Date(notice.published_at).toLocaleString(currentLocale())}
              </p>

              <small>
                {teacher
                  ? uiText("{0} người nhận",[notice.recipients])
                  : notice.is_read ? uiText("Đã đọc") : uiText("Chưa đọc")}
              </small>

              <button type="button" aria-expanded={expanded === notice.id}
                onClick={() => setExpanded(expanded === notice.id ? 0 : notice.id)}>
                {expanded === notice.id ? uiText("Thu gọn") : uiText("Xem nội dung")}
              </button>

              {expanded === notice.id && (
                <div className="course-feed-body">{notice.body}</div>
              )}

              {!teacher && !notice.is_read && (
                <button type="button" disabled={busy} onClick={() => void markRead(notice.id)}>
                  {uiText("Đánh dấu đã đọc")}</button>
              )}
            </article>
          ))}

          {feed.pagination.total_pages > 1 && (
            <nav aria-label={uiText("Phân trang thông báo")}>
              <button type="button" disabled={!feed.pagination.has_previous}
                onClick={() => setPage(n => n - 1)}>{uiText("Trước")}</button>
              <span>Trang {feed.pagination.page}/{feed.pagination.total_pages}</span>
              <button type="button" disabled={!feed.pagination.has_next}
                onClick={() => setPage(n => n + 1)}>Sau</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}