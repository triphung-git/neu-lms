import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { apiClient } from '../../../api/client';

type GradeNotice = {
  id: number;
  course_id: string;
  course_name: string;
  assignment_id: string;
  title: string;
  revision: number;
  score: string;
  published_at: string;
};

type GradeFeed = {
  items: GradeNotice[];
  pagination: { total_items: number };
};

type UpcomingFeed = {
  total: number;
  items: {
    id: string;
    course_id: string;
    course_name: string;
    title: string;
    deadline: string;
  }[];
};

type Result<T> = {
  owner: string;
  data: T | null;
  error: string;
};

function useDashboardFeed<T>(
  owner: string | undefined,
  url: string,
  pageSize?: number,
) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!owner) return;

    const controller = new AbortController();
    setResult(null);

    apiClient.untypedRequest<T>(url, {
      params: pageSize ? { page: 1, page_size: pageSize } : {},
      signal: controller.signal,
    })
      .then(data => {
        if (!controller.signal.aborted) {
          setResult({ owner, data, error: '' });
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setResult({
            owner,
            data: null,
            error: err instanceof Error ? err.message : uiText("Không tải được dữ liệu."),
          });
        }
      });

    return () => controller.abort();
  }, [owner, url, pageSize, attempt]);

  const current = result?.owner === owner ? result : null;

  return {
    data: current?.data ?? null,
    error: current?.error ?? '',
    retry: () => setAttempt(n => n + 1),
  };
}

export function useRecentGrades(owner?: string) {
  return useDashboardFeed<GradeFeed>(owner, '/api/v1/me/grade-notices', 3);
}

export function useUpcomingAssignments(owner?: string) {
  return useDashboardFeed<UpcomingFeed>(owner, '/api/v1/me/upcoming-assignments');
}