import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';

const changed = 'neu:grade-notices-changed';

export function refreshGradeBadge() {
  window.dispatchEvent(new Event(changed));
}

export function useUnreadGradeCount(
  userId?: string,
  url = '/api/v1/me/grade-notices/unread',
) {
  const [result, setResult] = useState({ userId: '', count: 0 });

  useEffect(() => {
    if (!userId) return;

    let controller: AbortController | undefined;

    function refresh() {
      if (!userId) return;

      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;

      apiClient
        .untypedRequest<{ unread_count: number }>(
          url, { signal }
        )
        .then(data => {
          if (!signal.aborted) {
            setResult({ userId, count: data.unread_count });
          }
        })
        .catch(() => {
          // Giữ số gần nhất khi mất kết nối.
        });
    }

    refresh();
    window.addEventListener(changed, refresh);
    window.addEventListener('focus', refresh);

    return () => {
      controller?.abort();
      window.removeEventListener(changed, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [userId, url]);

  return result.userId === userId ? result.count : 0;
}