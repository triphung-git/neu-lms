import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CourseChatPanel } from '../blueprints/ai/components/CourseChatPanel';
import { aiAssistantService, type SavedChatTurn } from '../api/aiAssistantService';
vi.mock('../app/providers/SessionContext', () => ({ useSession: () => ({ currentUser: { id: 'student' } }) }));
const turn: SavedChatTurn = { id: 1, request_id: 'uuid', question: 'HTTP là gì?', answer: 'HTTP là giao thức [S1].', created_at: '2026-11-04T00:00:00Z', citations: [{ id: 'S1', material_id: 'material', material_title: 'Giáo trình HTTP', course_code: 'WEB', course_name: 'Web', file_name: 'web.pdf', page_number: 2, excerpt: 'HTTP là giao thức.' }] };
beforeEach(() => { vi.spyOn(aiAssistantService, 'history').mockResolvedValue([turn]); });
afterEach(() => vi.restoreAllMocks());
function mount() { return render(<MemoryRouter><CourseChatPanel courseId="course" /></MemoryRouter>); }
describe('Saved course conversation', () => {
  it('loads saved answers on remount and links the cited material', async () => {
    const first = mount();
    expect(await screen.findByText(turn.answer)).toBeInTheDocument();
    fireEvent.click(screen.getByText('[S1] Giáo trình HTTP · Trang 2'));
    expect(screen.getByRole('link', { name: 'Mở học liệu' })).toHaveAttribute('href', '/sv/mon-hoc/course/hoc-lieu/material');
    first.unmount(); mount();
    expect(await screen.findByText(turn.answer)).toBeInTheDocument();
    expect(aiAssistantService.history).toHaveBeenCalledTimes(2);
  });
  it('requires confirmation before deleting history', async () => {
    const clear = vi.spyOn(aiAssistantService, 'clear').mockResolvedValue(undefined);
    mount(); await screen.findByText(turn.answer);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lịch sử' }));
    expect(clear).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa lịch sử' }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith('course'));
    await waitFor(() => expect(screen.queryByText(turn.answer)).not.toBeInTheDocument());
  });
  it('reuses request ID after a network failure', async () => {
    const chat = vi.spyOn(aiAssistantService, 'chat').mockRejectedValueOnce(new Error('Mất mạng')).mockResolvedValue({ answer: 'OK', citations: [], course: { id:'course', code:'C', name:'Course' } });
    mount(); await screen.findByText(turn.answer);
    fireEvent.change(screen.getByLabelText('Câu hỏi gửi tới trợ lý AI'), { target: { value: 'Giải thích HTTP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await screen.findByText('Mất mạng');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2));
    expect(chat.mock.calls[0][3]).toBeTruthy();
    expect(chat.mock.calls[0][3]).toBe(chat.mock.calls[1][3]);
  });
  it('blocks sending if saved history cannot be loaded, then retries', async () => {
    vi.mocked(aiAssistantService.history).mockRejectedValueOnce(new Error('Chưa tải được')).mockResolvedValue([]);
    mount(); await screen.findByText('Chưa tải được');
    expect(screen.getByRole('button', { name: 'Gửi câu hỏi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại hội thoại' }));
    await screen.findByText('Chưa có hội thoại. Hãy đặt câu hỏi cụ thể về học liệu.');
  });
});
