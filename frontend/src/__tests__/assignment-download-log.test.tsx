import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentDownloadLog } from '../blueprints/learning/AssignmentDownloadLog';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../blueprints/learning/api', () => ({ get: mocks.get, post: vi.fn(), root: '/api/v1/learning' }));
const hub = { manager: true, students: [{ student_id: 's1', student__display_name: 'Quang', student__email: 'quang@example.test' }], assignments: [{ id: 'a1', title: 'Bài 1' }] };
const data = { items: Array.from({ length: 26 }, (_, i) => ({ user__display_name: 'Quang', user__email: 'quang@example.test', assignment__title: 'Bài 1', file__file_name: `file-${i}.pdf`, kind: 'download', occurred_at: '2026-11-09T08:30:00Z' })), totals: [{ user__email: 'quang@example.test', file__file_name: 'answer.pdf', count: 26 }], total_events: 26, limit: 5000 };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.get.mockImplementation((path: string) => Promise.resolve(path.includes('/downloads') ? data : hub)); });
afterEach(cleanup);
it('shows logs inline with totals, timestamp, pagination and filter-specific CSV', async () => {
 render(<AssignmentDownloadLog courseId="c1" />);
 expect(await screen.findByText('file-0.pdf')).toBeInTheDocument();
 expect(screen.queryByText('file-25.pdf')).not.toBeInTheDocument();
 expect(screen.getByText('Tổng lượt tải:', { exact: false, selector: 'span' })).toBeTruthy();
 expect(screen.getAllByText(new Date('2026-11-09T08:30:00Z').toLocaleString('vi-VN')).length).toBe(25);
 fireEvent.click(screen.getByRole('button', { name: 'Sau' }));
 expect(screen.getByText('file-25.pdf')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Bài tập'), { target: { value: 'a1' } });
 fireEvent.change(screen.getByLabelText('Sinh viên'), { target: { value: 's1' } });
 fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));
 await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/courses/c1/downloads?assignment_id=a1&user_id=s1', expect.any(AbortSignal)));
 expect(screen.getByRole('link', { name: 'Xuất CSV' })).toHaveAttribute('href', '/api/v1/learning/courses/c1/downloads?assignment_id=a1&user_id=s1&export=csv');
 expect(await screen.findByText('file-0.pdf')).toBeInTheDocument();
});
it('shows a retry for API errors and then recovers', async () => {
 mocks.get.mockImplementation((path: string) => path.includes('/downloads') ? Promise.reject(new Error('Không tải được log')) : Promise.resolve(hub));
 render(<AssignmentDownloadLog courseId="c1" />);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được log');
 mocks.get.mockResolvedValue(data);
 fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
 expect(await screen.findByText('file-0.pdf')).toBeInTheDocument();
});
it('does not fetch download logs for a non-manager', async () => {
 mocks.get.mockResolvedValue({ ...hub, manager: false });
 render(<AssignmentDownloadLog courseId="c1" />);
 expect(await screen.findByRole('alert')).toHaveTextContent('Bạn không có quyền');
 expect(mocks.get).toHaveBeenCalledTimes(1);
});
it('rejects reversed date ranges before requesting data', async () => {
 render(<AssignmentDownloadLog courseId="c1" />);
 await screen.findByText('file-0.pdf');
 fireEvent.change(screen.getByLabelText('Từ'), { target: { value: '2026-11-10T12:00' } });
 fireEvent.change(screen.getByLabelText('Đến'), { target: { value: '2026-11-09T12:00' } });
 fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));
 expect(screen.getByRole('alert')).toHaveTextContent('Thời gian bắt đầu');
 expect(mocks.get).toHaveBeenCalledTimes(2);
});
