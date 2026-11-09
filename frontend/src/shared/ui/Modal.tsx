import {uiText} from "../i18n/translate";
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const timer = window.setTimeout(() => {
      const modal = modalRef.current;
      if (!modal || modal.contains(document.activeElement)) return;

      const firstInput = modal.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])'
      );
      const firstButton = modal.querySelector<HTMLElement>(
        'button:not([disabled]), [href], [tabindex="0"]'
      );
      (firstInput ?? firstButton ?? modal).focus();
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousActiveElement.current?.isConnected) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal-container modal-${size}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-description' : undefined}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title" className="modal-title">{title}</h2>
            {description && <p id="modal-description" className="modal-description">{description}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={uiText("Đóng hộp thoại")}
            icon={<X size={20} />}
          />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};
