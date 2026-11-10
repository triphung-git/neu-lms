import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportsPage } from '../blueprints/learning/ReportsPage';
vi.mock('../blueprints/learning/api', () => ({
  root: '/api/v1/learning', post: vi.fn(),
  get: vi.fn().mockResolvedValue({
    start:'2026-11-01T00:00:00+07:00', end:'2026-11-10T23:59:59+07:00',
    metrics:{submissions:0,group_submissions:0},download_trend:[],
  }),
}));
vi.mock('../blueprints/learning/i18n', () => ({
  useLanguage: () => ({ language:'vi', t:(vi:string) => vi }),
}));
it('exports the server-resolved period in both download links', async () => {
  render(<ReportsPage />);
  expect(screen.queryByRole('link',{name:'Xuất Excel có biểu đồ'})).toBeNull();
  const excel=await screen.findByRole('link',{name:'Xuất Excel có biểu đồ'});
  const url=new URL(excel.getAttribute('href')!, 'http://localhost');
  expect(url.searchParams.get('start')).toBe('2026-11-01T00:00:00+07:00');
  expect(url.searchParams.get('end')).toBe('2026-11-10T23:59:59+07:00');
  expect(url.searchParams.get('export')).toBe('xlsx');
  expect(url.searchParams.get('lang')).toBe('vi');
  expect(screen.getByRole('link',{name:'Xuất CSV'})).toHaveAttribute('href',expect.stringContaining('export=csv'));
});
