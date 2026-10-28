export { StudentAssignmentDetailPage } from './pages/StudentAssignmentDetailPage';
export { TeacherAssignmentListPage } from './pages/TeacherAssignmentListPage';
export { TeacherAssignmentEditPage } from './pages/TeacherAssignmentEditPage';

export type { AssignmentsPort } from './contracts/assignmentsPort';
export * from './contracts/assignmentsDto';
export { MockAssignmentsAdapter, mockAssignmentsAdapter } from './adapters/mockAssignmentsAdapter';
export { HttpAssignmentsAdapter, httpAssignmentsAdapter } from './adapters/httpAssignmentsAdapter';
export { checkSubmissionEligibility } from './domain/assignmentPolicies';
export {
  getAssignmentService,
  setAssignmentService,
  resetAssignmentService,
} from '../../app/composition/assignmentWiring';
