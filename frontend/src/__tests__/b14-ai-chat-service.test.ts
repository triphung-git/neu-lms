import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { aiAssistantService } from '../api/aiAssistantService';

const response = {
  answer: 'Nội dung được tìm thấy trong học liệu [S1].',
  citations: [],
  course: {
    id: '0a0a0a0a-1111-4111-8111-000000000001',
    code: 'WEB101',
    name: 'Phát triển Web',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B14 AI assistant service', () => {
  it('sends a course-scoped question to the chat API', async () => {
    const request = vi
      .spyOn(apiClient, 'untypedRequest')
      .mockResolvedValue(response);

    await aiAssistantService.chat(
      '0a0a0a0a-1111-4111-8111-000000000001',
      'Tóm tắt học liệu',
    );

    expect(request).toHaveBeenCalledWith(
      '/api/v1/ai/courses/0a0a0a0a-1111-4111-8111-000000000001/chat',
      {
        method: 'POST',
        body: { question: 'Tóm tắt học liệu' },
      },
    );
  });

  it('sends only the latest eight history messages', async () => {
    const request = vi
      .spyOn(apiClient, 'untypedRequest')
      .mockResolvedValue(response);
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Tin nhắn ${index + 1}`,
    }));

    await aiAssistantService.chat('course-id', 'Câu hỏi tiếp theo', history);

    expect(request).toHaveBeenCalledWith(
      '/api/v1/ai/courses/course-id/chat',
      {
        method: 'POST',
        body: {
          question: 'Câu hỏi tiếp theo',
          history: history.slice(-8),
        },
      },
    );
  });
});
