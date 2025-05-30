import { AccountAndProfileIdsParams, AccountIdParam } from '@ajgifford/keepwatching-common-server/schema';
import { statisticsService } from '@ajgifford/keepwatching-common-server/services';
import { NextFunction, Request, Response } from 'express';

/**
 * Get statistics (shows, movies and watch progress) for an account
 *
 * @route GET /api/v1/accounts/:accountId/statistics
 */
export async function getAccountStatistics(req: Request, res: Response, next: NextFunction) {
  try {
    const { accountId } = req.params as unknown as AccountIdParam;
    const results = await statisticsService.getAccountStatistics(accountId);

    res.status(200).json({
      message: 'Successfully retrieved account statistics',
      results,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get statistics (shows, movies and watch progress) for a profile
 *
 * @route GET /api/v1/accounts/:accountId/profiles/:profileId/statistics
 */
export async function getProfileStatistics(req: Request, res: Response, next: NextFunction) {
  try {
    const { profileId } = req.params as unknown as AccountAndProfileIdsParams;
    const results = await statisticsService.getProfileStatistics(profileId);

    res.status(200).json({
      message: 'Successfully retrieved profile statistics',
      results,
    });
  } catch (error) {
    next(error);
  }
}
