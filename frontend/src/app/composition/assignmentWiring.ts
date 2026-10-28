/**
 * Service Locator / Dependency Injection for Assignments Domain (B10).
 *
 * The HTTP adapter is the product default for B10 teacher/student assignment flows.
 * Submissions and grading remain outside this wiring until B11 and B12.
 */

import type { AssignmentsPort } from '../../blueprints/assignments/contracts/assignmentsPort';
import { httpAssignmentsAdapter } from '../../blueprints/assignments/adapters/httpAssignmentsAdapter';

class AssignmentWiring {
  private static instance: AssignmentsPort = httpAssignmentsAdapter;

  public static getService(): AssignmentsPort {
    return this.instance;
  }

  public static setService(customService: AssignmentsPort): void {
    this.instance = customService;
  }

  public static resetToDefault(): void {
    this.instance = httpAssignmentsAdapter;
  }
}

export const getAssignmentService = (): AssignmentsPort => AssignmentWiring.getService();
export const setAssignmentService = (service: AssignmentsPort): void => AssignmentWiring.setService(service);
export const resetAssignmentService = (): void => AssignmentWiring.resetToDefault();
