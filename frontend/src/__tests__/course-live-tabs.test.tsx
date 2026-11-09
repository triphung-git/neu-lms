import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Grades } from '../blueprints/grading/pages/StudentGradesPage';
import { CourseFeed } from '../blueprints/announcements/pages/CourseAnnouncements';
import { apiClient } from '../api/client';
vi.mock('../api/client', () => ({ apiClient: { untypedRequest: vi.fn() } }));
vi.mock('../blueprints/announcements/useUnreadGradeCount', () => ({ refreshGradeBadge: vi.fn() }));
const request = vi.mocked(apiClient.untypedRequest);
const pagination = { page: 1, total_pages: 1, total_items: 1, has_next: false, has_previous: false };
function Location() { return <output>{useLocation().search}</output>; }
beforeEach(() => vi.resetAllMocks());
describe('course panels', () => {
  it('loads published grades for the current course and displays feedback', async () => {
    request.mockResolvedValue({ items: [{ assignment_id: 'a1', title: 'Bài thực hành', course_id: 'c1', course_name: 'Web', course_code: 'WEB', revision_number: 1, total_score: '10.00', grade: { score: '8.00', feedback: 'Tốt', created_at: '2026-11-01T00:00:00Z' } }], pagination });
    render(<MemoryRouter><Grades courseId="c1" /></MemoryRouter>);
    expect(await screen.findByText('8.00/10.00')).toBeInTheDocument();
    expect(screen.getByText('Tốt')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/api/v1/me/grades', expect.objectContaining({ params: { page: 1, course_id: 'c1' } }));
    expect(screen.queryByText('Xem tất cả môn')).not.toBeInTheDocument();
  });
  it('allows retry after grade loading fails', async () => {
    request.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ items: [], pagination });
    render(<MemoryRouter><Grades courseId="c1" /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    fireEvent.click(screen.getByText('Cập nhật bảng điểm'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Chưa có bài tập/)).toBeInTheDocument();
  });
  it('scopes announcements, shows body, marks one read and preserves tab URL', async () => {
    request.mockResolvedValue({ items: [{ id: 7, title: 'Lịch học', body: 'Học thứ hai', course_name: 'Web', author_name: 'Giảng viên', published_at: '2026-11-01T00:00:00Z', is_read: false }], courses: [], pagination });
    render(<MemoryRouter initialEntries={['/?tab=thong-bao']}><CourseFeed teacher={false} fixedCourseId="c1" /><Location /></MemoryRouter>);
    await screen.findByText('Lịch học');
    expect(request).toHaveBeenCalledWith('/api/v1/me/course-announcements', expect.objectContaining({ params: { page: 1, course_id: 'c1' } }));
    expect(screen.queryByText('Đánh dấu đã đọc ở tất cả môn')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Xem nội dung'));
    expect(screen.getByText('Học thứ hai')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Đánh dấu đã đọc'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/me/course-announcements/7/read', { method: 'POST' }));
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/me/course-announcements', expect.objectContaining({ params: { page: 1, course_id: 'c1', unread: true } })));
    expect(screen.getByText('?tab=thong-bao')).toBeInTheDocument();
  });
});
