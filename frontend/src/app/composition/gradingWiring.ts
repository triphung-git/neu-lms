import type { GradingPort } from '../../blueprints/grading/contracts/gradingPort';
import { mockGradingAdapter } from '../../blueprints/grading/adapters/mockGradingAdapter';

/**
 * Service locator / Dependency Injection for Grading domain.
 * When real backend API client is ready, swap adapter here without modifying UI components.
 */
class GradingWiring {
  private static instance: GradingPort = mockGradingAdapter;

  public static getService(): GradingPort {
    return this.instance;
  }

  public static setService(customService: GradingPort): void {
    this.instance = customService;
  }
}

export const getGradingService = (): GradingPort => GradingWiring.getService();
