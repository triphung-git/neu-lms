import type { AssignmentsPort } from '../../blueprints/assignments/contracts/assignmentsPort';
import { mockAssignmentsAdapter } from '../../blueprints/assignments/adapters/mockAssignmentsAdapter';

/**
 * Service locator / Dependency Injection for Assignments domain.
 * When real backend API client is ready, swap adapter here without modifying UI components.
 */
class AssignmentWiring {
  private static instance: AssignmentsPort = mockAssignmentsAdapter;

  public static getService(): AssignmentsPort {
    return this.instance;
  }

  public static setService(customService: AssignmentsPort): void {
    this.instance = customService;
  }
}

export const getAssignmentService = (): AssignmentsPort => AssignmentWiring.getService();
