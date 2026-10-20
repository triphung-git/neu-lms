import type {
  User,
  ValidEmail,
  Course,
  Membership,
  Chapter,
  Lesson,
  Material,
  MaterialVersion,
  Assignment,
  Submission,
  GradeRevision,
  Announcement,
  EmailJob,
  AIDraft,
  AuditEvent,
  SystemSettings
} from '../../shared/kernel/types';

export interface DatabaseState {
  users: User[];
  validEmails: ValidEmail[];
  courses: Course[];
  memberships: Membership[];
  chapters: Chapter[];
  lessons: Lesson[];
  materials: Material[];
  materialVersions: MaterialVersion[];
  assignments: Assignment[];
  submissions: Submission[];
  gradeRevisions: GradeRevision[];
  announcements: Announcement[];
  emailJobs: EmailJob[];
  aiDrafts: AIDraft[];
  auditLogs: AuditEvent[];
  settings: SystemSettings;
}

export function createInitialSeed(): DatabaseState {
  // 1. Users
  const users: User[] = [
    {
      id: 'usr-admin-1',
      fullName: 'Quản trị viên Hệ thống',
      emailNormalized: 'quan-tri@example.edu.vn',
      role: 'admin',
      status: 'active',
      code: 'AD001',
      createdAt: '2026-08-01T08:00:00+07:00',
      lastLoginAt: '2026-10-18T09:30:00+07:00',
    },
    {
      id: 'usr-gv-1',
      fullName: 'TS. Nguyễn Văn Hùng',
      emailNormalized: 'giang-vien@example.edu.vn',
      role: 'teacher',
      status: 'active',
      code: 'GV001',
      createdAt: '2026-08-05T08:00:00+07:00',
      lastLoginAt: '2026-10-18T09:45:00+07:00',
    },
    {
      id: 'usr-gv-2',
      fullName: 'ThS. Trần Thị Mai',
      emailNormalized: 'giang-vien-2@example.edu.vn',
      role: 'teacher',
      status: 'active',
      code: 'GV002',
      createdAt: '2026-08-06T08:00:00+07:00',
      lastLoginAt: '2026-10-17T14:20:00+07:00',
    },
    {
      id: 'usr-sv-1',
      fullName: 'Nguyễn Thị Hương',
      emailNormalized: 'sinh-vien@example.edu.vn',
      role: 'student',
      status: 'active',
      code: 'SV001',
      createdAt: '2026-08-10T08:00:00+07:00',
      lastLoginAt: '2026-10-18T09:55:00+07:00',
    },
    {
      id: 'usr-sv-locked',
      fullName: 'Lê Văn Khóa',
      emailNormalized: 'khoa@example.edu.vn',
      role: 'student',
      status: 'locked',
      code: 'SV013',
      createdAt: '2026-08-10T08:00:00+07:00',
      lastLoginAt: '2026-09-01T10:00:00+07:00',
    },
  ];

  // Additional 11 active students (SV002 to SV012)
  const studentNames = [
    'Trần Minh Đức',
    'Phạm Hoàng Nam',
    'Lê Thu Trang',
    'Vũ Quốc Anh',
    'Hoàng Lan Anh',
    'Bùi Tiến Dũng',
    'Đỗ Thùy Linh',
    'Ngô Quang Huy',
    'Dương Tuấn Kiệt',
    'Phan Bảo Ngọc',
    'Võ Thành Đạt',
  ];

  studentNames.forEach((name, idx) => {
    const num = idx + 2;
    const pad = String(num).padStart(3, '0');
    users.push({
      id: `usr-sv-${num}`,
      fullName: name,
      emailNormalized: `sinh-vien-${num}@example.edu.vn`,
      role: 'student',
      status: 'active',
      code: `SV${pad}`,
      createdAt: '2026-08-10T08:00:00+07:00',
      lastLoginAt: '2026-10-17T16:00:00+07:00',
    });
  });

  // 2. 40 Valid Emails (baseline/04-DEMO-CONTRACT.md)
  const validEmails: ValidEmail[] = [];
  // Registered emails
  users.forEach((u) => {
    if (u.role === 'teacher' || u.role === 'student') {
      validEmails.push({
        emailNormalized: u.emailNormalized,
        fullName: u.fullName,
        assignedRole: u.role,
        registeredUserId: u.id,
        addedAt: u.createdAt,
      });
    }
  });

  // Unregistered eligible emails to complete 40
  const remainingNeeded = 40 - validEmails.length;
  for (let i = 1; i <= remainingNeeded; i++) {
    const isTeacher = i <= 3;
    const role = isTeacher ? 'teacher' : 'student';
    const email = isTeacher ? `giang-vien-cho-${i}@example.edu.vn` : `sinh-vien-cho-${i}@example.edu.vn`;
    const name = isTeacher ? `Giảng viên chờ ${i}` : `Sinh viên chờ ${i}`;
    validEmails.push({
      emailNormalized: email,
      fullName: name,
      assignedRole: role,
      addedAt: '2026-09-01T08:00:00+07:00',
    });
  }

  // 3. Courses (4 courses: 3 open, 1 archived)
  const courses: Course[] = [
    {
      id: 'crs-it101',
      code: 'IT101',
      name: 'Lập trình Web Cơ bản',
      term: 'HK1 2026-2027',
      description: 'Học phần nền tảng về HTML5, CSS3, JavaScript ES6 và kiến trúc ứng dụng web hiện đại.',
      teacherId: 'usr-gv-1',
      status: 'open',
    },
    {
      id: 'crs-ba201',
      code: 'BA201',
      name: 'Quản trị Học liệu Số',
      term: 'HK1 2026-2027',
      description: 'Nghiệp vụ tổ chức cây bài giảng, quy trình kiểm soát phiên bản và số hóa tài liệu học tập.',
      teacherId: 'usr-gv-1',
      status: 'open',
    },
    {
      id: 'crs-cs301',
      code: 'CS301',
      name: 'Cấu trúc Dữ liệu và Giải thuật',
      term: 'HK1 2026-2027',
      description: 'Phân tích độ phức tạp thuật toán, giải thuật tìm kiếm, sắp xếp và đồ thị cơ bản.',
      teacherId: 'usr-gv-2',
      status: 'open',
    },
    {
      id: 'crs-en101',
      code: 'EN101',
      name: 'Tiếng Anh Chuyên ngành CNTT',
      term: 'HK2 2025-2026',
      description: 'Đọc hiểu tài liệu kỹ thuật, thuật ngữ phần mềm và giao tiếp chuyên ngành công nghệ.',
      teacherId: 'usr-gv-1',
      status: 'archived',
      archivedAt: '2026-06-30T17:00:00+07:00',
    },
  ];

  // 4. Memberships (Student usr-sv-1 is member of all 4 courses)
  const memberships: Membership[] = [];
  courses.forEach((c) => {
    // Add main student usr-sv-1
    memberships.push({
      id: `mem-${c.id}-sv1`,
      courseId: c.id,
      emailNormalized: 'sinh-vien@example.edu.vn',
      userId: 'usr-sv-1',
      status: 'active',
      addedAt: '2026-08-15T08:00:00+07:00',
    });

    // Add other active students to IT101 and BA201
    if (c.id === 'crs-it101' || c.id === 'crs-ba201') {
      for (let s = 2; s <= 12; s++) {
        memberships.push({
          id: `mem-${c.id}-sv${s}`,
          courseId: c.id,
          emailNormalized: `sinh-vien-${s}@example.edu.vn`,
          userId: `usr-sv-${s}`,
          status: 'active',
          addedAt: '2026-08-15T08:00:00+07:00',
        });
      }
      // Add one pending membership
      memberships.push({
        id: `mem-${c.id}-pending-1`,
        courseId: c.id,
        emailNormalized: 'sinh-vien-cho-1@example.edu.vn',
        status: 'pending',
        addedAt: '2026-09-02T08:00:00+07:00',
      });
      // Add one withdrawn student
      memberships.push({
        id: `mem-${c.id}-withdrawn-1`,
        courseId: c.id,
        emailNormalized: 'sinh-vien-rut@example.edu.vn',
        userId: 'usr-sv-withdrawn',
        status: 'withdrawn',
        addedAt: '2026-08-15T08:00:00+07:00',
        withdrawnAt: '2026-09-10T10:00:00+07:00',
      });
    }
  });

  // 5. Chapters and Lessons (3 chapters x 2 lessons per course)
  const chapters: Chapter[] = [];
  const lessons: Lesson[] = [];

  courses.forEach((c) => {
    for (let ch = 1; ch <= 3; ch++) {
      const chId = `chp-${c.id}-${ch}`;
      chapters.push({
        id: chId,
        courseId: c.id,
        title: `Chương ${ch}: Kiến thức chuyên đề ${ch}`,
        description: `Mục tiêu, nội dung cốt lõi và các chỉ dẫn học tập cho phần ${ch}.`,
        order: ch,
      });

      for (let ls = 1; ls <= 2; ls++) {
        const lsId = `lsn-${c.id}-${ch}-${ls}`;
        lessons.push({
          id: lsId,
          courseId: c.id,
          chapterId: chId,
          title: `Bài học ${ch}.${ls}: Lý thuyết & Thực hành ${ls}`,
          description: `Tài liệu đọc trước, slide bài giảng và hướng dẫn bài tập phần ${ch}.${ls}.`,
          order: ls,
        });
      }
    }
  });

  // 6. Materials & MaterialVersions (16 materials)
  const materials: Material[] = [];
  const materialVersions: MaterialVersion[] = [];

  const matConfigs = [
    { id: 'mat-1', title: 'Giáo trình Tổng quan HTML5 & CSS3', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['Cơ bản', 'Slide'] },
    { id: 'mat-2', title: 'Tài liệu Thực hành Layout Flexbox & Grid', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['Thực hành', 'CSS'] },
    { id: 'mat-3', title: 'Đặc tả Kiến trúc SPA với React Router', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['React', 'Kiến trúc'] },
    { id: 'mat-4', title: 'Bài giảng JavaScript ES6 và Bất đồng bộ', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['JS', 'Lý thuyết'] },
    { id: 'mat-5', title: 'Bản thảo Đề cương Môn học Chi tiết', visibility: 'draft', scan: 'clean', extract: 'success', index: 'success', tags: ['Đề cương', 'Nội bộ'] },
    { id: 'mat-6', title: 'Hướng dẫn Cài đặt Node.js & Vite', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['Setup', 'Tool'] },
    { id: 'mat-7', title: 'Sơ đồ Luồng Xác thực Phân quyền (Bản scan ảnh)', visibility: 'class', scan: 'clean', extract: 'no_text', index: 'success', tags: ['Sơ đồ', 'Bảo mật'] },
    { id: 'mat-8', title: 'File Mẫu Bài tập Lớn (Đang quét mã độc)', visibility: 'class', scan: 'running', extract: 'pending', index: 'pending', tags: ['Bài tập', 'ZIP'] },
    { id: 'mat-9', title: 'Mã nguồn Tham khảo Không an toàn (Nhiễm mã độc)', visibility: 'draft', scan: 'infected', extract: 'error', index: 'error', tags: ['Cảnh báo'] },
    { id: 'mat-10', title: 'Tài liệu Lỗi Trích xuất Nội dung', visibility: 'class', scan: 'clean', extract: 'error', index: 'error', tags: ['Lỗi'] },
    { id: 'mat-11', title: 'Chỉ dẫn Tối ưu SEO và Web Vitals', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['Performance'] },
    { id: 'mat-12', title: 'Tài liệu Ẩn: Đáp án Bài kiểm tra Giữa kỳ', visibility: 'hidden', scan: 'clean', extract: 'success', index: 'success', tags: ['Nội bộ'] },
    { id: 'mat-13', title: 'Giáo trình Quản trị Học liệu số BA201', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['BA201'] },
    { id: 'mat-14', title: 'Mẫu Kế hoạch Giảng dạy Học kỳ', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['Kế hoạch'] },
    { id: 'mat-15', title: 'Tài liệu Thuật toán Sắp xếp CS301', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['CS301'] },
    { id: 'mat-16', title: 'Tài liệu Môn tiếng Anh EN101 (Đã lưu trữ)', visibility: 'class', scan: 'clean', extract: 'success', index: 'success', tags: ['EN101'] },
  ];

  matConfigs.forEach((cfg, index) => {
    const courseId = index >= 15 ? 'crs-en101' : index >= 14 ? 'crs-cs301' : index >= 12 ? 'crs-ba201' : 'crs-it101';
    const lessonId = lessons.find((l) => l.courseId === courseId)?.id || 'lsn-crs-it101-1-1';
    const ver1Id = `ver-${cfg.id}-1`;

    materialVersions.push({
      id: ver1Id,
      materialId: cfg.id,
      versionNumber: 1,
      filename: `${cfg.id}-tai-lieu-chuan.pdf`,
      mime: 'application/pdf',
      sizeBytes: 2450000,
      uploadedBy: 'usr-gv-1',
      uploadedAt: '2026-09-01T10:00:00+07:00',
      scanStatus: cfg.scan as any,
      extractionStatus: cfg.extract as any,
      indexStatus: cfg.index as any,
      summary: cfg.extract === 'success' ? 'Tài liệu tóm tắt những nội dung trọng tâm về cấu trúc bài giảng, kiến trúc mã nguồn và các quy ước kỹ thuật.' : undefined,
      contentExcerpt: cfg.extract === 'success' ? 'Chương 1: Mở đầu. Công nghệ web hiện đại phân chia rõ ranh giới giữa giao diện và logic dữ liệu...' : undefined,
    });

    materials.push({
      id: cfg.id,
      courseId,
      lessonId,
      title: cfg.title,
      tags: cfg.tags,
      visibility: cfg.visibility as any,
      currentVersionId: ver1Id,
      publishedVersionIds: cfg.visibility === 'class' && cfg.scan === 'clean' ? [ver1Id] : [],
    });
  });

  // 7. Assignments (8 assignments)
  const assignments: Assignment[] = [
    {
      id: 'asg-it101-1',
      courseId: 'crs-it101',
      title: 'Bài tập 01: Thiết kế Giao diện Web Cá nhân',
      instructions: 'Sinh viên xây dựng trang web cá nhân sử dụng HTML5 semantic và CSS3. Yêu cầu responsive 320px–1440px.',
      attachments: [{ name: 'de-bai-chi-tiet.pdf', sizeBytes: 512000 }],
      rubricCriteria: [
        { id: 'crit-1', title: 'Cấu trúc Semantic HTML', description: 'Sử dụng đúng thẻ header, main, nav, section, footer.', maxScore: 4.0 },
        { id: 'crit-2', title: 'Độ phản hồi Responsive CSS', description: 'Hiển thị tốt trên mobile và desktop không lỗi cuộn ngang.', maxScore: 4.0 },
        { id: 'crit-3', title: 'Tiêu chuẩn Tiếp cận Web (a11y)', description: 'Tương phản màu sắc, nhãn nút và focus outline rõ ràng.', maxScore: 2.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-10-20T23:59:00+07:00', // Còn 2 ngày so với DEMO_NOW
      allowLate: true,
      status: 'published',
    },
    {
      id: 'asg-it101-2',
      courseId: 'crs-it101',
      title: 'Bài tập 02: Xây dựng Layout Flexbox và CSS Grid',
      instructions: 'Thực hành dàn trang danh sách sản phẩm với CSS Grid và thanh điều hướng Flexbox.',
      attachments: [{ name: 'mau-layout.zip', sizeBytes: 1200000 }],
      rubricCriteria: [
        { id: 'crit-2-1', title: 'Kỹ thuật Flexbox', description: 'Căn chỉnh trục chính và trục phụ chính xác.', maxScore: 5.0 },
        { id: 'crit-2-2', title: 'Kỹ thuật Grid', description: 'Định nghĩa template column và gap đồng đều.', maxScore: 5.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-10-18T23:59:00+07:00', // Hôm nay 23:59
      allowLate: false,
      status: 'published',
    },
    {
      id: 'asg-it101-3',
      courseId: 'crs-it101',
      title: 'Bài tập 03: Tương tác DOM với JavaScript ES6',
      instructions: 'Tạo ứng dụng To-Do List có thêm, sửa, xóa và lưu trữ trạng thái local.',
      attachments: [],
      rubricCriteria: [
        { id: 'crit-3-1', title: 'Xử lý Sự kiện DOM', description: 'Bắt sự kiện click, submit mượt mà.', maxScore: 6.0 },
        { id: 'crit-3-2', title: 'Cấu trúc Dữ liệu Mảng', description: 'Sử dụng map, filter, reduce đúng ngữ nghĩa.', maxScore: 4.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-10-17T17:00:00+07:00', // Đã quá hạn 1 ngày
      allowLate: true,
      status: 'published',
    },
    {
      id: 'asg-it101-4',
      courseId: 'crs-it101',
      title: 'Bài tập 04: Đã đóng nhận bài thủ công',
      instructions: 'Bài kiểm tra nhanh kiến thức cơ bản đã được giảng viên kết thúc thu nhận.',
      attachments: [],
      rubricCriteria: [
        { id: 'crit-4-1', title: 'Đúng yêu cầu', description: 'Đáp ứng toàn bộ tiêu chí đề ra.', maxScore: 10.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-10-19T12:00:00+07:00',
      allowLate: false,
      manuallyClosedAt: '2026-10-18T08:00:00+07:00',
      status: 'published',
    },
    {
      id: 'asg-it101-draft',
      courseId: 'crs-it101',
      title: 'Bài tập 05: Bản nháp Bài tập Lớn Cuối kỳ',
      instructions: 'Đề bài đang được ban giảng viên biên soạn và thẩm định rubric.',
      attachments: [],
      rubricCriteria: [
        { id: 'crit-5-1', title: 'Tính hoàn thiện', description: 'Chưa chốt tiêu chí.', maxScore: 10.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-11-30T23:59:00+07:00',
      allowLate: true,
      status: 'draft',
    },
    {
      id: 'asg-it101-archived',
      courseId: 'crs-it101',
      title: 'Bài tập Khảo sát Đầu khóa (Đã lưu trữ)',
      instructions: 'Khảo sát năng lực ban đầu của sinh viên.',
      attachments: [],
      rubricCriteria: [
        { id: 'crit-arc-1', title: 'Hoàn thành khảo sát', description: 'Điền đầy đủ phiếu.', maxScore: 10.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-08-30T23:59:00+07:00',
      allowLate: false,
      status: 'archived',
    },
    {
      id: 'asg-ba201-1',
      courseId: 'crs-ba201',
      title: 'Bài tập Phân loại & Gắn thẻ Học liệu Số',
      instructions: 'Sinh viên xây dựng bảng kế hoạch phân loại tài liệu cho thư viện khoa.',
      attachments: [],
      rubricCriteria: [
        { id: 'crit-ba-1', title: 'Độ chính xác phân loại', description: 'Gắn thẻ đúng chuẩn.', maxScore: 10.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-10-25T23:59:00+07:00',
      allowLate: true,
      status: 'published',
    },
    {
      id: 'asg-en101-1',
      courseId: 'crs-en101',
      title: 'Bài tập Dịch Thuật ngữ Kỹ thuật (Môn lưu trữ)',
      instructions: 'Dịch 20 thuật ngữ React và DOM.',
      attachments: [],
      rubricCriteria: [
        { id: 'crit-en-1', title: 'Độ chính xác', description: 'Dịch đúng nghĩa.', maxScore: 10.0 },
      ],
      maxScore: 10.0,
      dueAt: '2026-06-20T23:59:00+07:00',
      allowLate: false,
      status: 'archived',
    },
  ];

  // 8. Submissions and GradeRevisions
  const submissions: Submission[] = [];
  const gradeRevisions: GradeRevision[] = [];

  // Student 1 (usr-sv-1) submitted Assignment 1 on time, revised once, already graded
  const sub1Rev1Id = 'rev-sub1-1';
  const sub1Rev2Id = 'rev-sub1-2';
  const sub1Id = 'sub-asg1-sv1';

  submissions.push({
    id: sub1Id,
    assignmentId: 'asg-it101-1',
    studentId: 'usr-sv-1',
    revisions: [
      {
        id: sub1Rev1Id,
        revisionNumber: 1,
        filename: 'bai-nop-lan-1.zip',
        mime: 'application/zip',
        sizeBytes: 1540000,
        submittedAt: '2026-10-15T14:30:00+07:00',
        isLate: false,
      },
      {
        id: sub1Rev2Id,
        revisionNumber: 2,
        filename: 'bai-nop-lan-2-chinh-sua.zip',
        mime: 'application/zip',
        sizeBytes: 1620000,
        submittedAt: '2026-10-17T09:15:00+07:00',
        isLate: false,
      },
    ],
    submittedAt: '2026-10-17T09:15:00+07:00',
    latestRevisionId: sub1Rev2Id,
    isLate: false,
    gradingStatus: 'graded',
  });

  // Grade for Student 1 on Assignment 1
  gradeRevisions.push({
    id: 'grd-sub1-1',
    submissionId: sub1Id,
    submissionRevisionId: sub1Rev2Id,
    criterionScores: [
      { criterionId: 'crit-1', score: 3.5 },
      { criterionId: 'crit-2', score: 4.0 },
      { criterionId: 'crit-3', score: 1.5 },
    ],
    feedback: 'Bài làm rất tốt, cấu trúc semantic rõ ràng, giao diện mobile mượt mà.',
    total: 9.0,
    status: 'published',
    authorId: 'usr-gv-1',
    createdAt: '2026-10-17T15:00:00+07:00',
    publishedAt: '2026-10-17T16:00:00+07:00',
  });

  // Student 2 (usr-sv-2) submitted Assignment 1 on time, draft grade
  const sub2Rev1Id = 'rev-sub2-1';
  const sub2Id = 'sub-asg1-sv2';
  submissions.push({
    id: sub2Id,
    assignmentId: 'asg-it101-1',
    studentId: 'usr-sv-2',
    revisions: [
      {
        id: sub2Rev1Id,
        revisionNumber: 1,
        filename: 'bai-nop-duc.zip',
        mime: 'application/zip',
        sizeBytes: 980000,
        submittedAt: '2026-10-16T11:00:00+07:00',
        isLate: false,
      },
    ],
    submittedAt: '2026-10-16T11:00:00+07:00',
    latestRevisionId: sub2Rev1Id,
    isLate: false,
    gradingStatus: 'in_progress',
  });

  // Draft grade for Student 2
  gradeRevisions.push({
    id: 'grd-sub2-1',
    submissionId: sub2Id,
    submissionRevisionId: sub2Rev1Id,
    criterionScores: [
      { criterionId: 'crit-1', score: 3.0 },
      { criterionId: 'crit-2', score: 3.5 },
      { criterionId: 'crit-3', score: 1.0 },
    ],
    feedback: 'Cần bổ sung thêm thẻ footer và tối ưu ảnh cho nhẹ hơn.',
    total: 7.5,
    status: 'draft',
    authorId: 'usr-gv-1',
    createdAt: '2026-10-18T09:00:00+07:00',
  });

  // Student 3 submitted Assignment 3 LATE (overdue)
  const sub3Rev1Id = 'rev-sub3-1';
  const sub3Id = 'sub-asg3-sv3';
  submissions.push({
    id: sub3Id,
    assignmentId: 'asg-it101-3',
    studentId: 'usr-sv-3',
    revisions: [
      {
        id: sub3Rev1Id,
        revisionNumber: 1,
        filename: 'bai-nop-nam-muon.zip',
        mime: 'application/zip',
        sizeBytes: 1100000,
        submittedAt: '2026-10-18T08:30:00+07:00', // Nộp muộn sau hạn 17/10
        isLate: true,
      },
    ],
    submittedAt: '2026-10-18T08:30:00+07:00',
    latestRevisionId: sub3Rev1Id,
    isLate: true,
    gradingStatus: 'ungraded',
  });

  // 9. Announcements (6 announcements)
  const announcements: Announcement[] = [
    {
      id: 'anc-1',
      courseId: 'crs-it101',
      title: 'Chào mừng các bạn sinh viên đến với học phần IT101',
      body: 'Đề nghị toàn thể sinh viên tải giáo trình chương 1 và chuẩn bị môi trường Node.js phiên bản mới nhất cho buổi học thực hành đầu tiên.',
      authorId: 'usr-gv-1',
      publishedAt: '2026-08-20T08:00:00+07:00',
      readByUserIds: ['usr-sv-1', 'usr-sv-2'],
      emailJobId: 'eml-1',
    },
    {
      id: 'anc-2',
      courseId: 'crs-it101',
      title: 'Nhắc nhở hạn nộp Bài tập 01 và tiêu chí chấm điểm',
      body: 'Hạn chót nộp Bài tập 01 là 23:59 ngày 20/10/2026. Các bạn lưu ý kiểm tra tính hợp lệ của file và đối chiếu kỹ với rubric.',
      authorId: 'usr-gv-1',
      publishedAt: '2026-10-16T10:00:00+07:00',
      readByUserIds: ['usr-sv-2'], // Student 1 has not read this one -> unread!
      emailJobId: 'eml-2',
    },
    {
      id: 'anc-3',
      courseId: 'crs-it101',
      title: 'Cập nhật tài liệu thực hành Flexbox & Grid mới',
      body: 'Giảng viên vừa tải lên phiên bản cập nhật có bổ sung ví dụ minh họa về subgrid.',
      authorId: 'usr-gv-1',
      publishedAt: '2026-10-17T14:00:00+07:00',
      readByUserIds: [],
    },
    {
      id: 'anc-4',
      courseId: 'crs-ba201',
      title: 'Thông báo lịch nộp bài tập lớn học phần BA201',
      body: 'Sinh viên chuẩn bị kế hoạch số hóa tài liệu theo danh mục được giao.',
      authorId: 'usr-gv-1',
      publishedAt: '2026-10-10T09:00:00+07:00',
      readByUserIds: ['usr-sv-1'],
    },
    {
      id: 'anc-5',
      courseId: 'crs-cs301',
      title: 'Lịch ôn tập cấu trúc dữ liệu cây và đồ thị',
      body: 'Buổi hướng dẫn trực tiếp sẽ diễn ra vào sáng thứ Bảy tuần tới.',
      authorId: 'usr-gv-2',
      publishedAt: '2026-10-12T15:00:00+07:00',
      readByUserIds: [],
    },
    {
      id: 'anc-6',
      courseId: 'crs-en101',
      title: 'Tổng kết điểm học phần tiếng Anh chuyên ngành',
      body: 'Môn học đã hoàn tất và lưu trữ hồ sơ theo quy định.',
      authorId: 'usr-gv-1',
      publishedAt: '2026-06-25T16:00:00+07:00',
      readByUserIds: ['usr-sv-1'],
    },
  ];

  // 10. Email Jobs
  const emailJobs: EmailJob[] = [
    {
      id: 'eml-1',
      type: 'announcement',
      entityId: 'anc-1',
      status: 'success',
      recipients: ['sinh-vien@example.edu.vn', 'sinh-vien-2@example.edu.vn'],
      failedRecipients: [],
      attempts: 1,
    },
    {
      id: 'eml-2',
      type: 'announcement',
      entityId: 'anc-2',
      status: 'partial_error',
      recipients: ['sinh-vien@example.edu.vn'],
      failedRecipients: ['sinh-vien-loi@example.edu.vn'],
      attempts: 2,
    },
  ];

  // 11. AI Drafts
  const aiDrafts: AIDraft[] = [
    {
      id: 'aid-1',
      courseId: 'crs-it101',
      sourceVersionIds: ['ver-mat-1-1'],
      type: 'summary',
      title: 'Tóm tắt Giáo trình HTML5 & CSS3',
      text: 'Nội dung cốt lõi của học liệu tập trung vào kiến trúc ngữ nghĩa HTML5, các nguyên tắc bố cục CSS hiện đại và cách tiếp cận thiết kế web đa màn hình.',
      status: 'confirmed',
      createdAt: '2026-09-02T10:00:00+07:00',
      confirmedBy: 'usr-gv-1',
      confirmedAt: '2026-09-02T10:15:00+07:00',
    },
    {
      id: 'aid-2',
      courseId: 'crs-it101',
      sourceVersionIds: ['ver-mat-3-1'],
      type: 'assignment',
      title: 'Đề xuất Bài tập Thực hành React Router',
      structuredContent: {
        title: 'Bài tập: Điều hướng Đa trang với React Router',
        instructions: 'Xây dựng ứng dụng SPA với 3 trang danh mục, chi tiết và giỏ hàng sử dụng React Router 7.',
        rubricCriteria: [
          { title: 'Cấu hình Router', description: 'Định nghĩa đúng route param và 404.', maxScore: 5.0 },
          { title: 'Quản lý Context', description: 'Chia sẻ dữ liệu trạng thái chuẩn.', maxScore: 5.0 },
        ],
      },
      status: 'pending',
      createdAt: '2026-10-18T08:00:00+07:00',
    },
  ];

  // 12. Audit Logs (30+ events)
  const auditLogs: AuditEvent[] = [];
  const sampleActions = [
    { action: 'SIGN_IN', entityType: 'User', result: 'success' },
    { action: 'UPDATE_SETTINGS', entityType: 'Settings', result: 'success' },
    { action: 'CREATE_COURSE', entityType: 'Course', result: 'success' },
    { action: 'UPLOAD_MATERIAL', entityType: 'Material', result: 'success' },
    { action: 'PUBLISH_ASSIGNMENT', entityType: 'Assignment', result: 'success' },
    { action: 'SUBMIT_ASSIGNMENT', entityType: 'Submission', result: 'success' },
    { action: 'PUBLISH_GRADE', entityType: 'GradeRevision', result: 'success' },
    { action: 'POST_ANNOUNCEMENT', entityType: 'Announcement', result: 'success' },
    { action: 'ARCHIVE_COURSE', entityType: 'Course', result: 'success' },
    { action: 'LOCK_USER', entityType: 'User', result: 'success' },
  ];

  for (let i = 1; i <= 32; i++) {
    const act = sampleActions[i % sampleActions.length];
    const hour = String(8 + (i % 10)).padStart(2, '0');
    const day = String(1 + (i % 17)).padStart(2, '0');
    auditLogs.push({
      id: `aud-${i}`,
      at: `2026-10-${day}T${hour}:15:00+07:00`,
      actorId: i % 3 === 0 ? 'usr-admin-1' : i % 2 === 0 ? 'usr-gv-1' : 'usr-sv-1',
      actorName: i % 3 === 0 ? 'Quản trị viên Hệ thống' : i % 2 === 0 ? 'TS. Nguyễn Văn Hùng' : 'Nguyễn Thị Hương',
      actorRole: i % 3 === 0 ? 'admin' : i % 2 === 0 ? 'teacher' : 'student',
      action: act.action,
      entityType: act.entityType,
      entityId: `ent-${i}`,
      result: (act.result as any),
      redactedDetails: `Hành động ${act.action} trên thực thể ${act.entityType} ent-${i}`,
    });
  }

  // 13. System Settings
  const settings: SystemSettings = {
    studentSubmissionFormats: ['PDF', 'DOCX', 'ZIP'],
    maxSubmissionFileMB: 25,
    aiEnabled: true,
    studentDailyAIQuota: 20,
    teacherMonthlyAIQuota: 500,
    emailEnabled: true,
  };

  return {
    users,
    validEmails,
    courses,
    memberships,
    chapters,
    lessons,
    materials,
    materialVersions,
    assignments,
    submissions,
    gradeRevisions,
    announcements,
    emailJobs,
    aiDrafts,
    auditLogs,
    settings,
  };
}
