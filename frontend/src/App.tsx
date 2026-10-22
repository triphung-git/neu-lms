import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Providers
import { DatabaseProvider } from './app/providers/DatabaseContext';
import { SessionProvider } from './app/providers/SessionContext';
import { ClockProvider } from './app/providers/ClockContext';
import { NotificationProvider } from './app/providers/NotificationContext';
import { RouteGuard } from './app/router/RouteGuard';

// Layouts
import { PublicLayout } from './app/layouts/PublicLayout';
import { AuthLayout } from './app/layouts/AuthLayout';
import { StudentLayout } from './app/layouts/StudentLayout';
import { TeacherLayout } from './app/layouts/TeacherLayout';
import { CourseTeacherLayout } from './app/layouts/CourseTeacherLayout';
import { AdminLayout } from './app/layouts/AdminLayout';

// Blueprints - Public (P01, P02, P03, P06)
import { HomePage, FeaturesPage, GuidePage, NotFoundPage } from './blueprints/public';

// Blueprints - Identity (P04, P05, C01)
import { LoginPage, RegisterPage, ProfilePage } from './blueprints/identity';

// Blueprints - Dashboards (S01, T01, A01)
import { StudentDashboardPage, TeacherDashboardPage, AdminDashboardPage } from './blueprints/dashboards';

// Blueprints - Courses (S02, S03, T02, T03, T04, T05, A05, A06)
import {
  StudentCoursesPage,
  StudentCourseDetailPage,
  TeacherCoursesPage,
  CreateCoursePage,
  TeacherCourseOverviewPage,
  CourseStructurePage,
  AdminCoursesPage,
  AdminCourseDetailPage
} from './blueprints/courses';

// Blueprints - Memberships (T06)
import { CourseMembersPage } from './blueprints/memberships';

// Blueprints - Materials (S04, S05, T07, T08, T09)
import {
  StudentMaterialDetailPage,
  StudentMaterialSearchPage,
  TeacherMaterialListPage,
  UploadMaterialPage,
  TeacherMaterialDetailPage
} from './blueprints/materials';

// Blueprints - Assignments (S06, T10, T11)
import {
  StudentAssignmentDetailPage,
  TeacherAssignmentListPage,
  TeacherAssignmentEditPage
} from './blueprints/assignments';

// Blueprints - Submissions (T12)
import { TeacherSubmissionsPage } from './blueprints/submissions';

// Blueprints - Grading (T13, T14, S07)
import { TeacherGradingPage, TeacherGradebookPage, StudentGradesPage } from './blueprints/grading';

// Blueprints - Announcements (S08, T15)
import { StudentAnnouncementsPage, TeacherAnnouncementsPage } from './blueprints/announcements';

// Blueprints - AI (T16)
import { TeacherAIDraftsPage } from './blueprints/ai';

// Blueprints - Administration (A02, A03, A04, A07, A08)
import {
  AdminEligibleEmailsPage,
  AdminAccountsPage,
  AdminAccountDetailPage,
  AdminAuditLogsPage,
  AdminSettingsPage
} from './blueprints/administration';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ClockProvider>
        <DatabaseProvider>
          <SessionProvider>
            <NotificationProvider>
              <Routes>
                {/* Public Shell Routes */}
                <Route path="/" element={<PublicLayout />}>
                  <Route index element={<HomePage />} />
                  <Route path="tinh-nang" element={<FeaturesPage />} />
                  <Route path="huong-dan" element={<GuidePage />} />
                  <Route path="404" element={<NotFoundPage />} />
                  <Route
                    path="ho-so"
                    element={
                      <RouteGuard>
                        <ProfilePage />
                      </RouteGuard>
                    }
                  />
                </Route>

                {/* Authentication Shell Routes */}
                <Route element={<AuthLayout />}>
                  <Route path="dang-nhap" element={<LoginPage />} />
                  <Route path="dang-ky" element={
                    import.meta.env.VITE_DATA_MODE === 'api' ? (
                    <div style={{ padding: 24 }}>
                      <h1>Đăng ký tài khoản</h1>
                      <p>
                        Biểu mẫu đăng ký đang được kết nối với máy chủ.
                        Hiện tại hãy sử dụng tài khoản đã tạo qua API.
                        </p>
                        <a href="/dang-nhap">Về trang đăng nhập</a>
                        </div>
                    ) : (
                    <RegisterPage />
                  )} />
                </Route>

                {/* Student Workspace (S01 - S08) */}
                <Route
                  path="sv"
                  element={
                    <RouteGuard allowedRoles={['student']}>
                      <StudentLayout />
                    </RouteGuard>
                  }
                >
                  <Route index element={<StudentDashboardPage />} />
                  <Route path="mon-hoc" element={<StudentCoursesPage />} />
                  <Route path="mon-hoc/:monId" element={<StudentCourseDetailPage />} />
                  <Route path="hoc-lieu/:hocLieuId" element={<StudentMaterialDetailPage />} />
                  <Route path="tim-kiem" element={<StudentMaterialSearchPage />} />
                  <Route path="bai-tap/:baiTapId" element={<StudentAssignmentDetailPage />} />
                  <Route path="diem" element={<StudentGradesPage />} />
                  <Route path="thong-bao" element={<StudentAnnouncementsPage />} />
                </Route>

                {/* Teacher Workspace (T01 - T16) */}
                <Route
                  path="gv"
                  element={
                    <RouteGuard allowedRoles={['teacher']}>
                      <TeacherLayout />
                    </RouteGuard>
                  }
                >
                  <Route index element={<TeacherDashboardPage />} />
                  <Route path="mon-hoc" element={<TeacherCoursesPage />} />
                  <Route path="mon-hoc/tao" element={<CreateCoursePage />} />
                  <Route path="hoc-lieu/:hocLieuId" element={<TeacherMaterialDetailPage />} />
                  <Route path="bai-tap/:baiTapId/bai-nop" element={<TeacherSubmissionsPage />} />
                  <Route path="bai-nop/:baiNopId/cham" element={<TeacherGradingPage />} />
                  <Route path="thong-bao" element={<TeacherAnnouncementsPage />} />
                  <Route path="ban-nhap-ai" element={<TeacherAIDraftsPage />} />

                  {/* Course Context for Teacher (T04, T05, T06, T07, T08, T10, T11, T14) */}
                  <Route path="mon-hoc/:monId" element={<CourseTeacherLayout />}>
                    <Route index element={<TeacherCourseOverviewPage />} />
                    <Route path="cau-truc" element={<CourseStructurePage />} />
                    <Route path="thanh-vien" element={<CourseMembersPage />} />
                    <Route path="hoc-lieu" element={<TeacherMaterialListPage />} />
                    <Route path="hoc-lieu/tai-len" element={<UploadMaterialPage />} />
                    <Route path="bai-tap" element={<TeacherAssignmentListPage />} />
                    <Route path="bai-tap/soan" element={<TeacherAssignmentEditPage />} />
                    <Route path="diem" element={<TeacherGradebookPage />} />
                  </Route>
                </Route>

                {/* Admin Workspace (A01 - A08) */}
                <Route
                  path="ad"
                  element={
                    <RouteGuard allowedRoles={['admin']}>
                      <AdminLayout />
                    </RouteGuard>
                  }
                >
                  <Route index element={<AdminDashboardPage />} />
                  <Route path="email-hop-le" element={<AdminEligibleEmailsPage />} />
                  <Route path="tai-khoan" element={<AdminAccountsPage />} />
                  <Route path="tai-khoan/:taiKhoanId" element={<AdminAccountDetailPage />} />
                  <Route path="mon-hoc" element={<AdminCoursesPage />} />
                  <Route path="mon-hoc/:monId" element={<AdminCourseDetailPage />} />
                  <Route path="nhat-ky" element={<AdminAuditLogsPage />} />
                  <Route path="cau-hinh" element={<AdminSettingsPage />} />
                </Route>

                {/* Catch-all Wildcard -> 404 */}
                <Route path="*" element={<Navigate to="/404" replace />} />
              </Routes>
            </NotificationProvider>
          </SessionProvider>
        </DatabaseProvider>
      </ClockProvider>
    </BrowserRouter>
  );
};

export default App;
