import React from 'react';
import { Shield, Sparkles, Users, BookOpen, CheckSquare, FileText, Lock } from 'lucide-react';
import './FeaturesPage.css';

export const FeaturesPage: React.FC = () => {
  return (
    <div className="features-container">
      <header className="features-header">
        <h1 className="features-title">Tính năng hệ thống NPC LMS / LCMS</h1>
        <p className="features-subtitle">
          Khám phá năng lực quản lý học phần, biên soạn học liệu, quy trình nộp bài tập và bảo mật giao diện được thiết kế theo tiêu chuẩn đại học.
        </p>
        <div className="features-quick-nav">
          <a href="#vai-tro" className="quick-link">Phân hệ theo vai trò</a>
          <a href="#ai" className="quick-link">Trợ lý AI có kiểm soát</a>
          <a href="#bao-mat" className="quick-link">Bảo mật giao diện & Giới hạn demo</a>
        </div>
      </header>

      {/* Role-based features */}
      <section id="vai-tro" className="feature-section" aria-labelledby="roles-title">
        <div className="section-header">
          <Users className="section-icon" />
          <h2 id="roles-title">1. Phân hệ theo ba vai trò độc lập</h2>
        </div>

        <div className="role-cards-grid">
          <div className="role-feature-card">
            <h3 className="role-name">Sinh viên</h3>
            <ul className="role-features-list">
              <li>
                <CheckSquare size={16} className="item-icon" />
                <span>Xem danh sách việc cần làm, hạn nộp sắp tới được sắp xếp theo thời gian thực.</span>
              </li>
              <li>
                <BookOpen size={16} className="item-icon" />
                <span>Truy cập cây chương, bài học và đọc học liệu trực tuyến đa phiên bản.</span>
              </li>
              <li>
                <FileText size={16} className="item-icon" />
                <span>Nộp bài tập đơn lẻ, hỗ trợ nộp thay thế trước hạn và lưu trữ lịch sử sửa đổi (revision).</span>
              </li>
              <li>
                <Sparkles size={16} className="item-icon" />
                <span>Tra cứu điểm đã công bố kèm nhận xét chi tiết theo từng tiêu chí rubric.</span>
              </li>
            </ul>
          </div>

          <div className="role-feature-card">
            <h3 className="role-name">Giảng viên</h3>
            <ul className="role-features-list">
              <li>
                <BookOpen size={16} className="item-icon" />
                <span>Khởi tạo môn học, quản lý cây chương - bài học với phím điều hướng lên/xuống.</span>
              </li>
              <li>
                <FileText size={16} className="item-icon" />
                <span>Upload học liệu số, phân phối đa phiên bản và theo dõi đường ống xử lý quét an toàn.</span>
              </li>
              <li>
                <CheckSquare size={16} className="item-icon" />
                <span>Soạn bài tập với tiêu chí rubric linh hoạt; chấm bài hai panel song song trực quan.</span>
              </li>
              <li>
                <Lock size={16} className="item-icon" />
                <span>Lưu trữ môn học (Archived) khi kết thúc kỳ giảng dạy để khóa ghi vĩnh viễn.</span>
              </li>
            </ul>
          </div>

          <div className="role-feature-card">
            <h3 className="role-name">Quản trị viên</h3>
            <ul className="role-features-list">
              <li>
                <Users size={16} className="item-icon" />
                <span>Quản lý danh sách email hợp lệ, hỗ trợ xem trước và nhập nhanh file CSV chuẩn RFC 4180.</span>
              </li>
              <li>
                <Shield size={16} className="item-icon" />
                <span>Khóa và mở khóa tài khoản người dùng với cơ chế bảo vệ phiên (self-guard).</span>
              </li>
              <li>
                <BookOpen size={16} className="item-icon" />
                <span>Giám sát danh mục môn học toàn trường, thực hiện chuyển giao giảng viên phụ trách.</span>
              </li>
              <li>
                <FileText size={16} className="item-icon" />
                <span>Tra cứu nhật ký kiểm toán (Audit Log) các hoạt động trọng yếu được khử định danh an toàn.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Controlled AI features */}
      <section id="ai" className="feature-section" aria-labelledby="ai-title">
        <div className="section-header">
          <Sparkles className="section-icon" />
          <h2 id="ai-title">2. Trợ lý AI có kiểm soát & Trích xuất nguồn</h2>
        </div>
        <div className="info-card">
          <p className="info-lead">
            Hệ thống áp dụng mô hình AI có ranh giới rõ ràng, bảo vệ tính trung thực trong học thuật:
          </p>
          <div className="info-grid">
            <div className="info-item">
              <h4>Đối chiếu học liệu gốc</h4>
              <p>Mọi câu trả lời của trợ lý AI dành cho sinh viên đều bắt buộc trích xuất số trang, đoạn văn cụ thể từ phiên bản học liệu đang học.</p>
            </div>
            <div className="info-item">
              <h4>Thẩm định bản nháp giảng viên</h4>
              <p>Giảng viên tạo bản tóm tắt hoặc đề xuất bài tập qua AI; nội dung chỉ hiển thị cho sinh viên khi giảng viên trực tiếp xác nhận (Confirm) và công bố.</p>
            </div>
            <div className="info-item">
              <h4>Quản lý hạn mức sử dụng</h4>
              <p>Cấu hình định ngạch sử dụng hàng ngày của sinh viên và hàng tháng của giảng viên để kiểm soát tài nguyên hợp lý.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Security and Demo Limitations */}
      <section id="bao-mat" className="feature-section" aria-labelledby="security-title">
        <div className="section-header">
          <Shield className="section-icon" />
          <h2 id="security-title">3. Bảo mật giao diện & Giới hạn minh họa</h2>
        </div>
        <div className="security-card">
          <div className="security-notice">
            <strong>Lưu ý về phiên bản Prototype:</strong>
            <p>
              Đây là bản thử nghiệm giao diện (Frontend Prototype) hoạt động với dữ liệu mô phỏng trong bộ nhớ trình duyệt (LocalStorage / SessionStorage). Hệ thống chưa kết nối cơ sở dữ liệu thật hoặc các dịch vụ quét virus trên máy chủ.
            </p>
          </div>
          <ul className="security-list">
            <li>Mật khẩu người dùng tạo mới chỉ được duy trì tạm thời trong phiên làm việc của bộ nhớ trình duyệt và sẽ bị hủy khi đăng xuất.</li>
            <li>Các tác vụ quét mã độc, trích xuất văn bản và gửi email thông báo đều là quy trình mô phỏng có định lượng thời gian để kiểm thử trải nghiệm người dùng.</li>
            <li>Không nhập mật khẩu thực tế hoặc thông tin cá nhân nhạy cảm vào hệ thống này.</li>
          </ul>
        </div>
      </section>
    </div>
  );
};
