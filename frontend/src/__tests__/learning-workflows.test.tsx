import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EnrollmentPage } from "../blueprints/learning/EnrollmentPage";
import { LibraryPage } from "../blueprints/learning/LibraryPage";
import { LanguageSwitch } from "../blueprints/learning/i18n";
import { ActionForm } from "../blueprints/learning/ui";
import { Groups } from "../blueprints/learning/WorkflowPanels";
import type { Hub } from "../blueprints/learning/LearningHub";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../blueprints/learning/api", () => ({
  ...mocks,
  root: "/api/v1/learning",
  upload: vi.fn(),
}));
vi.mock("../app/providers/SessionContext", () => ({
  useSession: () => ({ currentUser: { id: "s" } }),
}));
vi.mock("../api/client", () => ({
  apiClient: { untypedRequest: vi.fn().mockResolvedValue({ items: [] }) },
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.post.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
describe("Learning workflows", () => {
  it("persists language and changes new screen labels", async () => {
    mocks.get.mockResolvedValue({ items: [], terms: [], total: 0, page: 1 });
    render(
      <MemoryRouter>
        <LanguageSwitch />
        <EnrollmentPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Ngôn ngữ / Language"), {
      target: { value: "en" },
    });
    expect(
      screen.getByRole("heading", { name: "Join a course" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("lms-language")).toBe("en");
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });
  it("sends course password and links joined course", async () => {
    mocks.get.mockResolvedValue({
      items: [{ id: "course1", code: "CS101", name: "Python", requires_password: true }], terms: [], total: 1, page: 1,
    });
    render(
      <MemoryRouter>
        <EnrollmentPage />
      </MemoryRouter>,
    );
    const input = await screen.findByLabelText("Mật khẩu lớp");
    fireEvent.change(input, { target: { value: "class123" } });
    fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/enrollment", {
        course_id: "course1",
        password: "class123",
      }),
    );
    await waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(2));
  });
  it("shows server errors without fake success", async () => {
    mocks.post.mockRejectedValue(new Error("Invalid password"));
    const done = vi.fn();
    render(
      <ActionForm
        path="/enrollment"
        initial={{ course_id: "x" }}
        done={done}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid password",
    );
    expect(done).not.toHaveBeenCalled();
  });
  it("student library has downloads but no editing controls", async () => {
    mocks.get.mockResolvedValue({
      count: 1,
      items: [
        {
          id: 1,
          title: "Book",
          description: "Read me",
          category: "IT",
          tags: "Python",
          visibility: "course",
          hidden: false,
          owner: "Teacher",
          file_name: "book.pdf",
          course_id: "c",
          can_edit: false,
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/sv/thu-vien"]}>
        <LibraryPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("link", { name: "Tải xuống" }),
    ).toHaveAttribute("href", "/api/v1/learning/library/1");
    expect(
      screen.queryByRole("button", { name: "Xóa" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tải tài liệu lên" }),
    ).not.toBeInTheDocument();
  });
  it("offers group submission only to leader and shows published personal score", async () => {
    const hub = {
      course: { id: "c", name: "Course", status: "open" },
      manager: false,
      students: [],
      lessons: [],
      completed: [],
      assignments: [],
      enrollment_open: false,
      has_password: false,
    } as Hub;
    mocks.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("group-appeals")
          ? { items: [] }
          : {
              policies: [
                {
                  id: 1,
                  assignment_id: "a",
                  assignment__title: "Project",
                  assignment__total_score: "10",
                  max_members: 5,
                  formation_deadline: "2027-01-01",
                },
              ],
              items: [
                {
                  id: 1,
                  policy_id: 1,
                  name: "Team",
                  leader_id: "other",
                  mine: true,
                  members: [
                    { student_id: "s", student__display_name: "Student" },
                  ],
                  submissions: [
                    {
                      id: 2,
                      number: 1,
                      file_name: "group.pdf",
                      submitted_at: "2026-11-01",
                      is_late: false,
                      grade: {
                        id: 3,
                        version: 1,
                        score: "7.00",
                        feedback: "Good",
                        published: true,
                        adjustments: {},
                      },
                    },
                  ],
                },
              ],
            },
      ),
    );
    render(<Groups path="/courses/c" hub={hub} />);
    expect(
      await screen.findByRole("link", { name: "group.pdf" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nộp bài nhóm" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Phúc khảo điểm cá nhân" }),
    ).toBeInTheDocument();
  });
});
