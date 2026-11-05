import {uiText} from "../../../shared/i18n/translate";
import React, { useState } from 'react';
import { Tabs } from '../../../shared/ui/Tabs';
import { CheckCircle, HelpCircle } from 'lucide-react';
import './GuidePage.css';

interface GuideStep {
  step: number;
  title: string;
  description: string;
  tip?: string;
}

export const GuidePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('sv');

  const tabs = [
    { id: 'sv', label: uiText("Dành cho Sinh viên") },
    { id: 'gv', label: uiText("Dành cho Giảng viên") },
    { id: 'ad', label: uiText("Dành cho Quản trị viên") },
  ];

  const studentSteps: GuideStep[] = [
    {
      step: 1,
      title: uiText("Đăng nhập vào hệ thống"),
      description: uiText("Sử dụng tài khoản email sinh viên đã được quản trị viên cấp phép (ví dụ tài khoản minh họa sinh-vien@example.edu.vn)."),
      tip: uiText("Mật khẩu mẫu chung cho tài khoản minh họa là Demo@1234."),
    },
    {
      step: 2,
      title: uiText("Kiểm tra danh sách việc cần làm"),
      description: uiText("Truy cập trang “Việc cần làm” tại /sv để xem các bài tập sắp đến hạn nộp, điểm số mới được công bố và thông báo lớp học."),
    },
    {
      step: 3,
      title: uiText("Học tập và nghiên cứu học liệu"),
      description: uiText("Vào chi tiết môn học, chọn bài học và mở học liệu. Sinh viên có thể đọc preview trực tiếp, chọn phiên bản học liệu hoặc đặt câu hỏi cho trợ lý AI."),
    },
    {
      step: 4,
      title: uiText("Nộp bài tập và sửa đổi trước hạn"),
      description: uiText("Tải file bài tập lên trước hạn nộp (định dạng PDF, DOCX, ZIP tối đa 25 MB). Nếu còn hạn, sinh viên được quyền nộp thay thế file để cập nhật bài làm."),
      tip: uiText("Quá hạn nộp sẽ chỉ được nộp muộn nếu giảng viên bật tính năng cho phép nộp muộn."),
    },
    {
      step: 5,
      title: uiText("Tra cứu điểm và phản hồi từ giảng viên"),
      description: uiText("Xem bảng điểm tại /sv/diem khi giảng viên đã công bố kết quả. Mở chi tiết để xem nhận xét và điểm thành phần theo từng tiêu chí rubric."),
    },
  ];

  const teacherSteps: GuideStep[] = [
    {
      step: 1,
      title: uiText("Đăng nhập không gian giảng dạy"),
      description: uiText("Sử dụng tài khoản giảng viên (ví dụ giang-vien@example.edu.vn) để vào giao diện bàn làm việc tại /gv."),
    },
    {
      step: 2,
      title: uiText("Tạo môn và thiết lập cây bài giảng"),
      description: uiText("Tạo lớp học phần mới với mã môn viết hoa duy nhất. Tại mục Cấu trúc môn, thêm các chương và bài học, sắp xếp thứ tự thuận tiện bằng bàn phím."),
    },
    {
      step: 3,
      title: uiText("Đăng tải và phân phối học liệu"),
      description: uiText("Tải lên các tài liệu giáo trình, slide bài giảng. Theo dõi tiến trình quét mã độc và chuyển trạng thái từ Nháp sang Cả lớp để sinh viên truy cập."),
    },
    {
      step: 4,
      title: uiText("Soạn bài tập và thiết lập rubric"),
      description: uiText("Soạn bài tập với hạn nộp chính xác. Thêm các tiêu chí đánh giá rubric có điểm tối đa cụ thể. Có thể sử dụng bản nháp gợi ý từ trợ lý AI."),
    },
    {
      step: 5,
      title: uiText("Chấm bài và công bố điểm minh bạch"),
      description: uiText("Vào danh sách bài nộp, chấm từng sinh viên với phiếu rubric hai cột song song. Lưu bản nháp khi đang chấm và chỉ công bố khi đã hoàn tất."),
    },
  ];

  const adminSteps: GuideStep[] = [
    {
      step: 1,
      title: uiText("Truy cập cổng vận hành hệ thống"),
      description: uiText("Đăng nhập bằng tài khoản quản trị (quan-tri@example.edu.vn) để theo dõi tổng thể số liệu người dùng, môn học và nhật ký."),
    },
    {
      step: 2,
      title: uiText("Nhập danh sách email hợp lệ"),
      description: uiText("Quản trị viên tải file CSV danh sách cán bộ, giảng viên và sinh viên. Hệ thống tự động kiểm tra định dạng và cho phép xem trước trước khi xác nhận lưu."),
    },
    {
      step: 3,
      title: uiText("Quản trị tài khoản và phân quyền"),
      description: uiText("Khóa hoặc mở khóa tài khoản người dùng vi phạm. Đổi vai trò tài khoản với cơ chế bảo vệ không cho phép tự đổi quyền của chính mình."),
    },
    {
      step: 4,
      title: uiText("Giám sát và chuyển giao môn học"),
      description: uiText("Xem toàn bộ danh mục môn học toàn trường. Thực hiện chuyển giao quyền phụ trách môn cho giảng viên khác khi có quyết định phân công."),
    },
    {
      step: 5,
      title: uiText("Cấu hình hệ thống và rà soát nhật ký"),
      description: uiText("Thiết lập dung lượng nộp bài, bật/tắt AI và Email toàn trường. Kiểm tra nhật ký kiểm toán (Audit Log) để đảm bảo tuân thủ quy chế."),
    },
  ];

  const currentSteps = activeTab === 'sv' ? studentSteps : activeTab === 'gv' ? teacherSteps : adminSteps;

  return (
    <div className="guide-container">
      <header className="guide-header">
        <h1 className="guide-title">{uiText("Hướng dẫn sử dụng NPC LMS / LCMS")}</h1>
        <p className="guide-subtitle">
          {uiText("Quy trình 5 bước thao tác chuẩn cho từng vai trò trên nền tảng quản lý học tập.")}</p>
      </header>

      <div className="guide-tabs-wrapper">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      <div className="guide-steps-list" role="list">
        {currentSteps.map((st) => (
          <div key={st.step} className="guide-step-card" role="listitem">
            <div className="step-badge" aria-hidden="true">
              {st.step}
            </div>
            <div className="step-body">
              <h3 className="step-title">{st.title}</h3>
              <p className="step-description">{st.description}</p>
              {st.tip && (
                <div className="step-tip">
                  <CheckCircle size={15} className="tip-icon" />
                  <span>{st.tip}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="guide-support-box">
        <HelpCircle size={24} className="support-icon" />
        <div>
          <h4>{uiText("Cần hỗ trợ kỹ thuật bổ sung?")}</h4>
          <p>
            {uiText("Vui lòng liên hệ Phòng Đào tạo hoặc Trung tâm Công nghệ Thông tin nhà trường qua các kênh thông báo chính thức để được trợ giúp tài khoản và đăng ký môn học.")}</p>
        </div>
      </div>
    </div>
  );
};
