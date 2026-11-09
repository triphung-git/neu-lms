import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../shared/ui/Modal';
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.style.overflow = ''; });
it('keeps input focus while typing and Escape uses the latest callback', () => {
 vi.useFakeTimers(); const close = vi.fn();
 function Form() {
  const [value, setValue] = useState('');
  return <Modal isOpen title="Add student" onClose={() => close(value)}><input aria-label="Email" value={value} onChange={e => setValue(e.target.value)} /></Modal>;
 }
 render(<Form />); act(() => vi.advanceTimersByTime(60));
 const input = screen.getByRole('textbox'); expect(input).toHaveFocus();
 for (const value of ['q','qu','quang@example.test']) {
  fireEvent.change(input, {target: {value}});
  act(() => vi.advanceTimersByTime(60));
  expect(input).toHaveFocus();
 }
 fireEvent.keyDown(document, {key:'Escape'});
 expect(close).toHaveBeenCalledWith('quang@example.test');
 fireEvent.click(screen.getByRole('button', {name:'Đóng hộp thoại'}));
 expect(close).toHaveBeenCalledTimes(2);
});
it('cancels delayed focus and restores the opener and scroll state', () => {
 vi.useFakeTimers(); document.body.style.overflow = 'auto';
 const opener = document.createElement('button'); document.body.append(opener); opener.focus();
 const {unmount} = render(<Modal isOpen title="Dialog" onClose={() => {}}><input /></Modal>);
 expect(document.body.style.overflow).toBe('hidden');
 unmount(); act(() => vi.advanceTimersByTime(60));
 expect(opener).toHaveFocus(); expect(document.body.style.overflow).toBe('auto'); opener.remove();
});
