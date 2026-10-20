import React from 'react';
import { FolderOpen } from 'lucide-react';
import './EmptyState.css';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
}) => {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon || <FolderOpen size={40} />}
      </div>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-description">{description}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
};
