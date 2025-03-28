import * as episodesDb from '../db/episodesDb';
import { cliLogger } from '../logger/logger';
import { BadRequestError } from '../middleware/errorMiddleware';
import Account from '../models/account';
import Profile from '../models/profile';
import Season from '../models/season';
import Show from '../models/show';
import { getEpisodeToAirId, getInProduction, getUSNetwork, getUSRating } from '../utils/contentUtility';
import { generateGenreArrayFromIds } from '../utils/genreUtility';
import { filterUSOrEnglishShows } from '../utils/usSearchFilter';
import { getUSWatchProviders } from '../utils/watchProvidersUtility';
import { CacheService } from './cacheService';
import { errorService } from './errorService';
import { getSocketInstance } from './socketService';
import { getTMDBService } from './tmdbService';

// Cache invalidation constants
const CACHE_KEYS = {
  PROFILE_SHOWS: (profileId: string) => `profile_${profileId}_shows`,
  PROFILE_SHOW: (profileId: string, showId: number) => `profile_${profileId}_show_${showId}`,
  PROFILE_EPISODES: (profileId: string) => `profile_${profileId}_episodes`,
  PROFILE_RECENT_EPISODES: (profileId: string) => `profile_${profileId}_recent_episodes`,
  PROFILE_UPCOMING_EPISODES: (profileId: string) => `profile_${profileId}_upcoming_episodes`,
  PROFILE_UNWATCHED_EPISODES: (profileId: string) => `profile_${profileId}_unwatched_episodes`,
};

/**
 * Service class for handling show-related business logic
 * This separates the business logic from the controller layer
 */
export class ShowService {
  private cache: CacheService;

  constructor() {
    this.cache = new CacheService();
  }

  /**
   * Invalidate all caches related to a profile
   */
  public invalidateProfileCache(profileId: string): void {
    this.cache.invalidatePattern(`profile_${profileId}`);
  }

  /**
   * Invalidate all caches related to an account by running through it's profiles
   */
  public async invalidateAccountCache(accountId: number): Promise<void> {
    const profiles = await Profile.getAllByAccountId(accountId);
    for (const profile of profiles) {
      this.invalidateProfileCache(String(profile.id!));
    }
  }

  /**
   * Retrieves all shows for a specific profile with caching
   *
   * @param profileId - ID of the profile to get shows for
   * @returns Shows associated with the profile
   */
  public async getShowsForProfile(profileId: string) {
    try {
      return await this.cache.getOrSet(
        CACHE_KEYS.PROFILE_SHOWS(profileId),
        () => Show.getAllShowsForProfile(profileId),
        600, // 10 minutes TTL
      );
    } catch (error) {
      throw errorService.handleError(error, `getShowsForProfile(${profileId})`);
    }
  }

  /**
   * Retrieves a show and all its details for a specific profile
   *
   * @param profileId - ID of the profile to get the show for
   * @param showId - ID of the show to retrieve
   * @returns Detailed show information
   * @throws {NotFoundError} If the show isn't found
   */
  public async getShowDetailsForProfile(profileId: string, showId: string) {
    try {
      const show = await this.cache.getOrSet(
        `profile_${profileId}_show_details_${showId}`,
        () => Show.getShowDetailsForProfile(profileId, showId),
        600, // 10 minutes TTL
      );

      errorService.assertExists(show, 'Show', showId);
      return show;
    } catch (error) {
      throw errorService.handleError(error, `getShowDetailsForProfile(${profileId}, ${showId})`);
    }
  }

  /**
   * Retrieves recent, upcoming, and next unwatched episodes for a profile with caching
   *
   * @param profileId - ID of the profile to get episodes for
   * @returns Object containing recent, upcoming, and next unwatched episodes
   */
  public async getEpisodesForProfile(profileId: string) {
    try {
      return await this.cache.getOrSet(
        CACHE_KEYS.PROFILE_EPISODES(profileId),
        async () => {
          const [recentEpisodes, upcomingEpisodes, nextUnwatchedEpisodes] = await Promise.all([
            episodesDb.getRecentEpisodesForProfile(profileId),
            episodesDb.getUpcomingEpisodesForProfile(profileId),
            Show.getNextUnwatchedEpisodesForProfile(profileId),
          ]);

          return {
            recentEpisodes,
            upcomingEpisodes,
            nextUnwatchedEpisodes,
          };
        },
        300, // 5 minutes TTL
      );
    } catch (error) {
      throw errorService.handleError(error, `getEpisodesForProfile(${profileId})`);
    }
  }

  /**
   * Adds a show to a profile's favorites
   *
   * @param profileId - ID of the profile to add the show for
   * @param showId - TMDB ID of the show to add
   * @returns Object containing the favorited show and updated episode lists
   */
  public async addShowToFavorites(profileId: string, showId: number) {
    try {
      const existingShowToFavorite = await Show.findByTMDBId(showId);
      if (existingShowToFavorite) {
        return await this.favoriteExistingShow(existingShowToFavorite, profileId);
      }

      return await this.favoriteNewShow(showId, profileId);
    } catch (error) {
      throw errorService.handleError(error, `addShowToFavorites(${profileId}, ${showId})`);
    }
  }

  /**
   * Adds an existing show to a profile's favorites
   *
   * @param showToFavorite - Show to add to favorites
   * @param profileId - ID of the profile to add the show for
   * @returns Object containing the favorited show and updated episode lists
   */
  private async favoriteExistingShow(showToFavorite: Show, profileId: string) {
    await showToFavorite.saveFavorite(profileId, true);

    this.invalidateProfileCache(profileId);

    const show = await Show.getShowForProfile(profileId, showToFavorite.id!);
    const episodeData = await this.getEpisodesForProfile(profileId);

    return {
      favoritedShow: show,
      ...episodeData,
    };
  }

  /**
   * Adds a new show (not yet in the database) to a profile's favorites
   * Fetches show data from TMDB API, saves it to the database, and adds to favorites
   *
   * @param showId - TMDB ID of the show to add
   * @param profileId - ID of the profile to add the show for
   * @returns Object containing the favorited show
   */
  private async favoriteNewShow(showId: number, profileId: string) {
    const tmdbService = getTMDBService();
    const responseShow = await tmdbService.getShowDetails(showId);

    const newShowToFavorite = new Show(
      responseShow.id,
      responseShow.name,
      responseShow.overview,
      responseShow.first_air_date,
      responseShow.poster_path,
      responseShow.backdrop_path,
      responseShow.vote_average,
      getUSRating(responseShow.content_ratings),
      undefined,
      getUSWatchProviders(responseShow, 9999),
      responseShow.number_of_episodes,
      responseShow.number_of_seasons,
      responseShow.genres.map((genre: { id: any }) => genre.id),
      responseShow.status,
      responseShow.type,
      getInProduction(responseShow),
      responseShow.last_air_date,
      getEpisodeToAirId(responseShow.last_episode_to_air),
      getEpisodeToAirId(responseShow.next_episode_to_air),
      getUSNetwork(responseShow.networks),
    );

    const isSaved = await newShowToFavorite.save();
    if (!isSaved) {
      throw new BadRequestError('Failed to save the show as a favorite');
    }

    await newShowToFavorite.saveFavorite(profileId, false);
    this.invalidateProfileCache(profileId);

    // Start background process to fetch seasons and episodes
    const show = await Show.getShowForProfile(profileId, newShowToFavorite.id!);
    this.fetchSeasonsAndEpisodes(responseShow, newShowToFavorite.id!, profileId);

    return { favoritedShow: show };
  }

  /**
   * Loads all seasons and episodes for a show from the TMDB API
   * This is a potentially long-running operation that runs in the background
   *
   * @param show - Show data from TMDB API
   * @param showId - ID of the show in the database
   * @param profileId - ID of the profile to add the show for
   */
  private async fetchSeasonsAndEpisodes(show: any, showId: number, profileId: string): Promise<void> {
    try {
      const tmdbService = getTMDBService();
      const validSeasons = show.seasons.filter((season: any) => {
        return season.season_number > 0;
      });

      for (const responseSeason of validSeasons) {
        const responseData = await tmdbService.getSeasonDetails(show.id, responseSeason.season_number);

        const season = new Season(
          showId,
          responseSeason.id,
          responseSeason.name,
          responseSeason.overview,
          responseSeason.season_number,
          responseSeason.air_date,
          responseSeason.poster_path,
          responseSeason.episode_count,
        );
        await season.save();
        await season.saveFavorite(Number(profileId));

        for (const responseEpisode of responseData.episodes) {
          const episode = await episodesDb.saveEpisode(
            episodesDb.createEpisode(
              responseEpisode.id,
              showId,
              season.id!,
              responseEpisode.episode_number,
              responseEpisode.episode_type,
              responseEpisode.season_number,
              responseEpisode.name,
              responseEpisode.overview,
              responseEpisode.air_date,
              responseEpisode.runtime,
              responseEpisode.still_path,
            ),
          );
          await episodesDb.saveFavorite(Number(profileId), episode.id!);
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      this.notifyShowDataLoaded(profileId, showId);
    } catch (error) {
      cliLogger.error('Error fetching seasons and episodes:', error);
    }
  }

  /**
   * Notifies the client that show data has been fully loaded via WebSockets
   *
   * @param profileId - ID of the profile that favorited the show
   * @param showId - ID of the show in the database
   */
  private async notifyShowDataLoaded(profileId: string, showId: number): Promise<void> {
    try {
      const io = getSocketInstance();
      if (!io) return;

      const account_id = await Account.findAccountIdByProfileId(profileId);
      const loadedShow = await Show.getShowForProfile(profileId, showId);

      const sockets = Array.from(io.sockets.sockets.values());
      const userSocket = sockets.find((socket) => socket.data.accountId === account_id);

      if (userSocket) {
        userSocket.emit('updateShowFavorite', {
          message: 'Show data has been fully loaded',
          show: loadedShow,
        });
      }
    } catch (error) {
      cliLogger.error('Error notifying show data loaded:', error);
    }
  }

  /**
   * Removes a show from a profile's favorites
   *
   * @param profileId - ID of the profile to remove the show from
   * @param showId - ID of the show to remove
   * @returns Object containing information about the removed show and updated episode lists
   */
  public async removeShowFromFavorites(profileId: string, showId: number) {
    try {
      const showToRemove = await Show.findById(showId);
      errorService.assertExists(showToRemove, 'Show', showId);

      await showToRemove.removeFavorite(profileId);

      this.invalidateProfileCache(profileId);

      const episodeData = await this.getEpisodesForProfile(profileId);

      return {
        removedShow: showToRemove,
        ...episodeData,
      };
    } catch (error) {
      throw errorService.handleError(error, `removeShowFromFavorites(${profileId}, ${showId})`);
    }
  }

  /**
   * Updates the watch status of a show
   *
   * @param profileId - ID of the profile to update the watch status for
   * @param showId - ID of the show to update
   * @param status - New watch status ('WATCHED', 'WATCHING', or 'NOT_WATCHED')
   * @param recursive - Whether to update all seasons and episodes as well
   * @returns Success state of the update operation
   */
  public async updateShowWatchStatus(profileId: string, showId: number, status: string, recursive: boolean = false) {
    try {
      const success = recursive
        ? await Show.updateAllWatchStatuses(profileId, showId, status)
        : await Show.updateWatchStatus(profileId, showId, status);

      if (!success) {
        throw new BadRequestError(
          `Failed to update watch status. Ensure the show (ID: ${showId}) exists in your favorites.`,
        );
      }

      this.cache.invalidate(CACHE_KEYS.PROFILE_SHOW(profileId, showId));
      this.cache.invalidate(CACHE_KEYS.PROFILE_SHOWS(profileId));
      this.cache.invalidate(CACHE_KEYS.PROFILE_UNWATCHED_EPISODES(profileId));

      return success;
    } catch (error) {
      throw errorService.handleError(error, `updateShowWatchStatus(${profileId}, ${showId}, ${status}, ${recursive})`);
    }
  }

  /**
   * Update watch status for a show when new seasons are added
   * If a show was previously marked as WATCHED, update to WATCHING since there's new content
   * @param showId ID of the show in the database
   * @param profileIds List of profile IDs that have this show in their watchlist
   */
  public async updateShowWatchStatusForNewContent(showId: number, profileIds: number[]): Promise<void> {
    try {
      for (const profileId of profileIds) {
        const watchStatus = await Show.getWatchStatus(String(profileId), showId);

        if (watchStatus === 'WATCHED') {
          await Show.updateWatchStatus(String(profileId), showId, 'WATCHING');
        }
      }
    } catch (error) {
      throw errorService.handleError(error, `updateShowWatchStatusForNewContent(${showId})`);
    }
  }

  /**
   * Gets recommendations for similar shows based on a given show
   *
   * @param profileId - ID of the profile requesting recommendations
   * @param showId - ID of the show to get recommendations for
   * @returns Array of recommended shows
   */
  public async getShowRecommendations(profileId: string, showId: number) {
    try {
      const show = await Show.findById(showId);
      errorService.assertExists(show, 'Show', showId);

      return await this.cache.getOrSet(
        `recommendations_${showId}`,
        async () => {
          const tmdbService = getTMDBService();
          const response = await tmdbService.getShowRecommendations(show.tmdb_id);
          const responseShows = filterUSOrEnglishShows(response.results);

          const userShows = await Show.getAllShowsForProfile(profileId);
          const userShowIds = new Set(userShows.map((s) => s.tmdb_id));

          const recommendations = responseShows.map((rec: any) => ({
            id: rec.id,
            title: rec.name,
            genres: generateGenreArrayFromIds(rec.genre_ids),
            premiered: rec.first_air_date,
            summary: rec.overview,
            image: rec.poster_path,
            rating: rec.vote_average,
            popularity: rec.popularity,
            country: rec.origin_country,
            language: rec.original_language,
            inFavorites: userShowIds.has(rec.id),
          }));

          return recommendations;
        },
        86400, // 24 hours TTL
      );
    } catch (error) {
      throw errorService.handleError(error, `getShowRecommendations(${profileId}, ${showId})`);
    }
  }

  /**
   * Gets similar shows based on a given show
   *
   * @param profileId - ID of the profile requesting similar shows
   * @param showId - ID of the show to get recommendations for
   * @returns Array of recommended shows
   */
  public async getSimilarShows(profileId: string, showId: number) {
    try {
      const show = await Show.findById(showId);
      errorService.assertExists(show, 'Show', showId);

      return await this.cache.getOrSet(
        `similarShows_${showId}`,
        async () => {
          const tmdbService = getTMDBService();
          const response = await tmdbService.getSimilarShows(show.tmdb_id);
          const responseShows = filterUSOrEnglishShows(response.results);

          const userShows = await Show.getAllShowsForProfile(profileId);
          const userShowIds = new Set(userShows.map((s) => s.tmdb_id));

          const similarShows = responseShows.map((rec: any) => ({
            id: rec.id,
            title: rec.name,
            genres: generateGenreArrayFromIds(rec.genre_ids),
            premiered: rec.first_air_date,
            summary: rec.overview,
            image: rec.poster_path,
            rating: rec.vote_average,
            popularity: rec.popularity,
            country: rec.origin_country,
            language: rec.original_language,
            inFavorites: userShowIds.has(rec.id),
          }));

          return similarShows;
        },
        86400, // 24 hours TTL
      );
    } catch (error) {
      throw errorService.handleError(error, `getSimilarShows(${profileId}, ${showId})`);
    }
  }

  /**
   * Get statistics about a profile's shows
   *
   * @param profileId - ID of the profile to get statistics for
   * @returns Object containing various watch statistics
   */
  public async getProfileShowStatistics(profileId: string) {
    try {
      return await this.cache.getOrSet(
        `profile_${profileId}_show_stats`,
        async () => {
          const shows = await Show.getAllShowsForProfile(profileId);

          // Calculate basic statistics
          const total = shows.length;
          const watched = shows.filter((s) => s.watch_status === 'WATCHED').length;
          const watching = shows.filter((s) => s.watch_status === 'WATCHING').length;
          const notWatched = shows.filter((s) => s.watch_status === 'NOT_WATCHED').length;

          // Get genre distribution
          const genreCounts: Record<string, number> = {};
          shows.forEach((show) => {
            if (show.genres && typeof show.genres === 'string') {
              // Split the comma-separated string into an array
              const genreArray = show.genres.split(',').map((genre) => genre.trim());

              // Count occurrences of each genre
              genreArray.forEach((genre: string) => {
                if (genre) {
                  // Skip empty strings
                  genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                }
              });
            }
          });

          // Get streaming service distribution
          const serviceCounts: Record<string, number> = {};
          shows.forEach((show) => {
            if (show.streaming_services && typeof show.streaming_services === 'string') {
              // Split the comma-separated string into an array
              const serviceArray = show.streaming_services.split(',').map((service) => service.trim());

              // Count occurrences of each service
              serviceArray.forEach((service: string) => {
                if (service) {
                  // Skip empty strings
                  serviceCounts[service] = (serviceCounts[service] || 0) + 1;
                }
              });
            }
          });

          return {
            total: total,
            watchStatusCounts: { watched, watching, notWatched },
            genreDistribution: genreCounts,
            serviceDistribution: serviceCounts,
            watchProgress: total > 0 ? Math.round((watched / total) * 100) : 0,
          };
        },
        1800, // 30 minutes TTL
      );
    } catch (error) {
      throw errorService.handleError(error, `getShowStatistics(${profileId})`);
    }
  }

  /**
   * Get detailed watch progress for a profile including episode counts
   *
   * @param profileId - ID of the profile to get watch progress for
   * @returns Detailed watch progress statistics
   */
  public async getProfileWatchProgress(profileId: string) {
    try {
      return await this.cache.getOrSet(
        `profile_${profileId}_watch_progress`,
        async () => {
          const shows = await Show.getAllShowsForProfile(profileId);

          let totalEpisodes = 0;
          let watchedEpisodes = 0;

          // For each show, get season data with episode counts
          const showsProgress = await Promise.all(
            shows.map(async (show) => {
              const seasons = await Season.getSeasonsForShow(profileId, show.show_id.toString());

              const showEpisodeCount = seasons.reduce((sum, season) => sum + season.episodes.length, 0);
              const showWatchedCount = seasons.reduce((sum, season) => {
                return sum + season.episodes.filter((ep) => ep.watch_status === 'WATCHED').length;
              }, 0);

              totalEpisodes += showEpisodeCount;
              watchedEpisodes += showWatchedCount;

              return {
                showId: show.show_id,
                title: show.title,
                status: show.watch_status,
                totalEpisodes: showEpisodeCount,
                watchedEpisodes: showWatchedCount,
                percentComplete: showEpisodeCount > 0 ? Math.round((showWatchedCount / showEpisodeCount) * 100) : 0,
              };
            }),
          );

          return {
            totalEpisodes,
            watchedEpisodes,
            overallProgress: totalEpisodes > 0 ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0,
            showsProgress: showsProgress,
          };
        },
        3600, // 1 hour TTL
      );
    } catch (error) {
      throw errorService.handleError(error, `getWatchProgress(${profileId})`);
    }
  }
}

// Export a singleton instance of the service
export const showService = new ShowService();
