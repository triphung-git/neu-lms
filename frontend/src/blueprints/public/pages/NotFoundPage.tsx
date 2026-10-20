import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../app/providers/SessionContext';
import { Button } from '../../../shared/ui/Button';
import { HelpCircle, ArrowLeft } from 'lucide-react';
import './NotFoundPage.css';

export const NotFoundPage: React.FC = () => {
  const { currentUser, role } = useSession();
  const navigate = useNavigate();

  const handleReturnHome = () => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    if (role === 'admin') navigate('/ad');
    else if (role === 'teacher') navigate('/gv');
    else navigate('/sv');
  };

  return (
    <div className="notfound-container">
      <div className="notfound-card" role="alert">
        <div className="notfound-icon" aria-hidden="true">
          <HelpCircle size={48} />
        </div>
        <h1 className="notfound-code">404</h1>
        <h2 className="notfound-title">Không tìm thấy trang yêu cầu</h2>
        <p className="notfound-desc">
          Trang bạn đang truy cập không tồn tại, đã được di chuyển hoặc bạn không có quyền truy cập vào đường dẫn này.
        </p>
        <div className="notfound-actions">
          <Button
            variant="primary"
            onClick={handleReturnHome}
            icon={<ArrowLeft size={16} />}
          >
            Về không gian chính
          </Button>
        </div>
      </div>
    </div>
  );
};
