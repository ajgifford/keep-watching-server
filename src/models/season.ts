import { DatabaseError } from '../middleware/errorMiddleware';
import { ProfileEpisode, ProfileSeason } from '../types/showTypes';
import { getDbPool } from '../utils/db';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

/**
 * Represents a TV show season with associated metadata and watch status tracking.
 * This class provides methods for creating, updating, and managing seasons and their
 * relationships with shows, episodes, and user profiles.
 * @class Season
 */
class Season {
  /** Unique identifier for the season (optional, set after saving to database) */
  id?: number;
  /** ID of the show this season belongs to */
  readonly show_id: number;
  /** TMDB API identifier for the season */
  readonly tmdb_id: number;
  /** Name of the season */
  readonly name: string;
  /** Synopsis/description of the season */
  readonly overview: string;
  /** Season number of this season */
  readonly season_number: number;
  /** Original release date of the season */
  readonly release_date: string;
  /** Path to the season's poster image */
  readonly poster_image: string;
  /** Number of episodes in the season */
  readonly number_of_episodes: number;
  /** An array of episodes for the season (optional, set when loading all seasons for a show) */
  episodes?: ProfileEpisode[] = [];

  /**
   * Creates a new Season instance
   * @param showId - ID of the show this season belongs to
   * @param tmdbId - TMDB API identifier for the season
   * @param name - Name of the season
   * @param overview - Synopsis/description of the season
   * @param seasonNumber - Season number of this season
   * @param releaseDate - Original release date of the season
   * @param posterImage - Path to the season's poster image
   * @param numberOfEpisodes - The number of episodes in the season
   * @param id - Optional ID for an existing season
   */
  constructor(
    showId: number,
    tmdbId: number,
    name: string,
    overview: string,
    seasonNumber: number,
    releaseDate: string,
    posterImage: string,
    numberOfEpisodes: number,
    id?: number,
  ) {
    this.show_id = showId;
    this.tmdb_id = tmdbId;
    this.name = name;
    this.overview = overview;
    this.season_number = seasonNumber;
    this.release_date = releaseDate;
    this.poster_image = posterImage;
    this.number_of_episodes = numberOfEpisodes;
    if (id) this.id = id;
  }

  /**
   * Saves a new season to the database
   * @returns A promise that resolves when the season has been saved
   * @throws {DatabaseError} If a database error occurs during the operation such as connection failure or constraint violation
   *
   * @example
   * const season = new Season(1, 12345, 'Season 1', 'First season', 1, '2023-01-01', '/path/to/poster.jpg', 10);
   * await season.save();
   * console.log(season.id); // The newly assigned database ID
   */
  async save(): Promise<void> {
    try {
      const query =
        'INSERT INTO seasons (show_id, tmdb_id, name, overview, season_number, release_date, poster_image, number_of_episodes) VALUES (?,?,?,?,?,?,?,?)';
      const [result] = await getDbPool().execute<ResultSetHeader>(query, [
        this.show_id,
        this.tmdb_id,
        this.name,
        this.overview,
        this.season_number,
        this.release_date,
        this.poster_image,
        this.number_of_episodes,
      ]);
      this.id = result.insertId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown database error saving a season';
      throw new DatabaseError(errorMessage, error);
    }
  }

  /**
   * Updates an existing season or inserts a new one if it doesn't exist
   * This method performs an "upsert" operation using the MySQL ON DUPLICATE KEY UPDATE syntax
   *
   * @returns A promise that resolves when the season has been updated
   * @throws {DatabaseError} If a database error occurs during the operation
   *
   * @example
   * const season = new Season(1, 12345, 'Season 1 Updated', 'Updated description', 1, '2023-01-01', '/path/to/new_poster.jpg', 12, 5);
   * await season.update();
   */
  async update(): Promise<void> {
    try {
      const query =
        'INSERT INTO seasons (show_id, tmdb_id, name, overview, season_number, release_date, poster_image, number_of_episodes) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), name = ?, overview = ?, season_number = ?, release_date = ?, poster_image = ?, number_of_episodes = ?';
      const [result] = await getDbPool().execute<ResultSetHeader>(query, [
        // Insert Values
        this.show_id,
        this.tmdb_id,
        this.name,
        this.overview,
        this.season_number,
        this.release_date,
        this.poster_image,
        this.number_of_episodes,
        // Update Values
        this.name,
        this.overview,
        this.season_number,
        this.release_date,
        this.poster_image,
        this.number_of_episodes,
      ]);
      this.id = result.insertId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown database error updating a season';
      throw new DatabaseError(errorMessage, error);
    }
  }

  /**
   * Adds this season to a user's favorites
   * This creates an entry in the season_watch_status table to track the user's interest in this season
   *
   * @param profileId - ID of the profile to add this season to as a favorite
   * @returns A promise that resolves when the favorite has been added
   * @throws {DatabaseError} If a database error occurs during the operation
   *
   * @example
   * const season = new Season(1, 12345, 'Season 1', 'First season', 1, '2023-01-01', '/path/to/poster.jpg', 10, 5);
   * await season.saveFavorite(123); // Associate with profile ID 123
   */
  async saveFavorite(profileId: number): Promise<void> {
    try {
      const query = 'INSERT IGNORE INTO season_watch_status (profile_id, season_id) VALUES (?,?)';
      await getDbPool().execute(query, [profileId, this.id]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error saving a season as a favorite';
      throw new DatabaseError(errorMessage, error);
    }
  }

  /**
   * Updates the watch status of a season for a specific profile
   *
   * @param profileId - ID of the profile to update the watch status for
   * @param seasonId - ID of the season to update
   * @param status - New watch status ('WATCHED', 'WATCHING', or 'NOT_WATCHED')
   * @returns `True` if the watch status was updated, `false` if no rows were affected
   * @throws {DatabaseError} If a database error occurs during the operation
   *
   * @example
   * // Mark season 5 as watched for profile 123
   * const updated = await Season.updateWatchStatus('123', 5, 'WATCHED');
   * if (updated) {
   *   console.log('Season status updated successfully');
   * }
   */
  static async updateWatchStatus(profileId: string, seasonId: number, status: string): Promise<boolean> {
    try {
      const seasonQuery = 'UPDATE season_watch_status SET status = ? WHERE profile_id = ? AND season_id = ?';
      const [result] = await getDbPool().execute<ResultSetHeader>(seasonQuery, [status, profileId, seasonId]);

      // Return true if at least one row was affected (watch status was updated)
      return result.affectedRows > 0;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error updating a season watch status';
      throw new DatabaseError(errorMessage, error);
    }
  }

  /**
   * Updates the watch status of a season for a specific profile based on the status of its episodes.
   * This method examines all episodes associated with the season and determines the appropriate
   * season status based on episode statuses.
   *
   * - If all episodes have the same status, the season gets that status
   * - If episodes have mixed statuses, the season is marked as "WATCHING"
   * - If no episodes exist or no watch status information is available, nothing is updated
   *
   * @param profileId - ID of the profile to update the watch status for
   * @param seasonId - ID of the season to update
   * @returns A promise that resolves when the update is complete
   * @throws {DatabaseError} If a database error occurs during the operation
   *
   * @example
   * // Update season watch status based on its episodes
   * await Season.updateWatchStatusByEpisode("123", 456);
   */
  static async updateWatchStatusByEpisode(profileId: string, seasonId: number): Promise<void> {
    try {
      const pool = getDbPool();

      const episodeWatchStatusQuery = `SELECT CASE WHEN COUNT(DISTINCT ews.status) = 1 THEN MAX(ews.status) ELSE 'WATCHING' END AS season_status FROM episodes e JOIN episode_watch_status ews ON e.id = ews.episode_id WHERE e.season_id = ? AND ews.profile_id = ?`;
      const [statusResult] = await pool.execute<RowDataPacket[]>(episodeWatchStatusQuery, [seasonId, profileId]);

      if (!statusResult.length) return;

      const updateSeasonStatusQuery =
        'UPDATE season_watch_status SET status = ? WHERE profile_id = ? AND season_id = ?';
      const seasonStatus = statusResult[0].season_status;
      await pool.execute(updateSeasonStatusQuery, [seasonStatus, profileId, seasonId]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error updating a season watch status using episodes';
      throw new DatabaseError(errorMessage, error);
    }
  }

  /**
   * Updates the watch status of a season and its episodes for a specific profile
   *
   * This method uses a transaction to ensure that both the season and all its episodes
   * are updated consistently to the same watch status
   *
   * @param profileId - ID of the profile to update the watch status for
   * @param seasonId - ID of the season to update
   * @param status - New watch status ('WATCHED', 'WATCHING', or 'NOT_WATCHED')
   * @returns `True` if the watch status was updated, `false` if no rows were affected
   * @throws {DatabaseError} If a database error occurs during the operation
   *
   * @example
   * // Mark season 5 and all its episodes as watched for profile 123
   * const updated = await Season.updateAllWatchStatuses('123', 5, 'WATCHED');
   */
  static async updateAllWatchStatuses(profileId: string, seasonId: number, status: string): Promise<boolean> {
    const pool = getDbPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      //update season
      const seasonQuery = 'UPDATE season_watch_status SET status = ? WHERE profile_id = ? AND season_id = ?';
      const [seasonResult] = await connection.execute<ResultSetHeader>(seasonQuery, [status, profileId, seasonId]);
      if (seasonResult.affectedRows === 0) return false;

      //update episodes (for seasons)
      const episodeQuery =
        'UPDATE episode_watch_status SET status = ? WHERE profile_id = ? AND episode_id IN (SELECT id from episodes where season_id = ?)';
      const [episodeResult] = await connection.execute<ResultSetHeader>(episodeQuery, [status, profileId, seasonId]);

      await connection.commit();

      return episodeResult.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown database error updating all watch statuses of a season (including episodes)';
      throw new DatabaseError(errorMessage, error);
    } finally {
      connection.release();
    }
  }

  /**
   * Gets all seasons for a specific show and profile with watch status
   *
   * This method retrieves all seasons for a show and then loads all episodes for those seasons.
   * It organizes the data into a hierarchical structure with episodes grouped by season.
   *
   * @param profileId - ID of the profile to get seasons for
   * @param showId - ID of the show to get seasons for
   * @returns Array of seasons with watch status and their episodes
   * @throws {DatabaseError} If a database error occurs during the operation
   *
   * @example
   * // Get all seasons with episodes for show 10 and profile 123
   * const seasons = await Season.getSeasonsForShow('123', '10');
   * console.log(`Found ${seasons.length} seasons with a total of ${seasons.reduce((sum, season) => sum + season.episodes.length, 0)} episodes`);
   */
  static async getSeasonsForShow(profileId: string, showId: string): Promise<ProfileSeason[]> {
    try {
      const seasonQuery = 'SELECT * FROM profile_seasons WHERE profile_id = ? AND show_id = ? ORDER BY season_number';
      const [seasonRows] = await getDbPool().execute<RowDataPacket[]>(seasonQuery, [Number(profileId), Number(showId)]);

      if (seasonRows.length === 0) return [];

      const seasonIds = seasonRows.map((season) => season.season_id);
      const placeholders = seasonIds.map(() => '?').join(',');

      const episodeQuery = `SELECT * FROM profile_episodes WHERE profile_id = ? AND season_id IN (${placeholders}) ORDER BY season_id, episode_number`;
      const [episodeRows] = await getDbPool().execute<RowDataPacket[]>(episodeQuery, [Number(profileId), ...seasonIds]);

      const episodesBySeasonId: Record<number, ProfileEpisode[]> = {};
      episodeRows.forEach((episode) => {
        if (!episodesBySeasonId[episode.season_id]) {
          episodesBySeasonId[episode.season_id] = [];
        }
        episodesBySeasonId[episode.season_id].push(episode as ProfileEpisode);
      });

      return seasonRows.map((season) => ({
        ...season,
        episodes: episodesBySeasonId[season.season_id] || [],
      })) as ProfileSeason[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error getting all seasons for a show';
      throw new DatabaseError(errorMessage, error);
    }
  }

  static async getShowIdForSeason(seasonId: number): Promise<number | null> {
    try {
      const query = 'SELECT show_id FROM seasons WHERE id = ?';
      const [rows] = await getDbPool().execute<RowDataPacket[]>(query, [seasonId]);
      if (rows.length === 0) return null;

      return rows[0].show_id;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error getting the show id for a season';
      throw new DatabaseError(errorMessage, error);
    }
  }

  static async getWatchStatus(profileId: string, seasonId: number): Promise<string | null> {
    try {
      const query = 'SELECT status FROM season_watch_status WHERE profile_id = ? AND season_id = ?';
      const [rows] = await getDbPool().execute<RowDataPacket[]>(query, [profileId, seasonId]);

      if (rows.length === 0) return null;

      return rows[0].status;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error getting the watch status for a season';
      throw new DatabaseError(errorMessage, error);
    }
  }
}

export default Season;
