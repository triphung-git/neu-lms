/**
 * Service Locator / Dependency Injection for Assignments Domain (B10).
 *
 * The HTTP adapter is the product default for assignment workflows, including
 * the B11 submission-intake boundary. Server-side grading is handled by the
 * submission/grading API components in the grading and submissions blueprints.
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
