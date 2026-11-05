import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiClient } from '../api/client';
import { SubmissionGradePanel } from '../blueprints/submissions/pages/SubmissionGradePanel';

const submissionId = '00000000-0000-4000-8000-000000000012';
const rubricDetail = {
  total_score: '10.00',
  grade: null,
  rubric: [
    {
      id: '00000000-0000-4000-8000-000000000101',
      title: 'Phân tích yêu cầu',
      max_score: '4.00',
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      title: 'Triển khai giải pháp',
      max_score: '6.00',
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B12: API-backed grading panel', () => {
  it('loads rubric and publishes a grade through the server API', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest');
    request.mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return {
          version: 1,
          score: '9.00',
          feedback: 'Làm tốt.',
          status: 'published',
          created_at: '2026-11-03T01:00:00+07:00',
          rubric_breakdown: [],
        };
      }
      return rubricDetail;
    });

    render(<SubmissionGradePanel submissionId={submissionId} editable />);

    expect(await screen.findByText('Chưa có điểm được công bố.')).toBeInTheDocument();
    const scoreInputs = screen.getAllByRole('textbox');
    fireEvent.change(scoreInputs[0], { target: { value: '4' } });
    fireEvent.change(scoreInputs[1], { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Nhận xét'), {
      target: { value: 'Làm tốt.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Công bố điểm' }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        `/api/v1/submissions/${submissionId}/grade`,
        expect.objectContaining({
          method: 'POST',
          body: {
            rubric_scores: [
              {
                criterion_id: '00000000-0000-4000-8000-000000000101',
                score: '4.00',
              },
              {
                criterion_id: '00000000-0000-4000-8000-000000000102',
                score: '5.00',
              },
            ],
            feedback: 'Làm tốt.',
            status: 'published',
            expected_version: 0,
          },
        }),
      );
    });

    expect(await screen.findByText('Đã công bố điểm.')).toBeInTheDocument();
  });
});
