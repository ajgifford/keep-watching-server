import pool from '../utils/db';
import Episode from './episode';

class Season {
  id?: number;
  readonly show_id: number;
  readonly tmdb_id: number;
  readonly name: string;
  readonly overview: string;
  readonly season_number: number;
  readonly release_date: string;
  readonly image: string;
  readonly number_of_episodes: number;
  episodes?: Episode[] = [];

  constructor(
    show_id: number,
    tmdb_id: number,
    name: string,
    overview: string,
    season_number: number,
    release_date: string,
    image: string,
    number_of_episode: number,
    id?: number,
  ) {
    this.show_id = show_id;
    this.tmdb_id = tmdb_id;
    this.name = name;
    this.overview = overview;
    this.season_number = season_number;
    this.release_date = release_date;
    this.image = image;
    this.number_of_episodes = number_of_episode;
    if (id) this.id = id;
  }

  async save() {
    const query =
      'INSERT into seasons (show_id, tmdb_id, name, overview, season_number, release_date, image, number_of_episodes) VALUE (?,?,?,?,?,?,?,?)';
    const [result] = await pool.execute(query, [
      this.show_id,
      this.tmdb_id,
      this.name,
      this.overview,
      this.season_number,
      this.release_date,
      this.image,
      this.number_of_episodes,
    ]);
    this.id = (result as any).insertId;
  }

  async saveFavorite(profile_id: string) {
    const query = 'INSERT into season_watch_status (profile_id, season_id) VALUE (?,?)';
    await pool.execute(query, [Number(profile_id), this.id]);
  }

  static async saveFavoriteWithEpisodes(profile_id: string, season_id: number) {
    const query = 'INSERT into season_watch_status (profile_id, season_id) VALUE (?,?)';
    await pool.execute(query, [Number(profile_id), season_id]);
    const episodeQuery = 'SELECT id FROM episodes WHERE season_id = ?';
    const [rows] = await pool.execute(episodeQuery, [season_id]);
    const episode_ids = rows as any[];
    episode_ids.forEach((id) => {
      Episode.saveFavorite(profile_id, id.id);
    });
  }

  static async updateWatchStatus(profile_id: string, season_id: number, status: string): Promise<boolean> {
    const query = 'UPDATE season_watch_status SET status = ? WHERE profile_id = ? AND season_id = ?';
    const [result] = await pool.execute(query, [status, profile_id, season_id]);
    if ((result as any).affectedRows === 0) return false;
    return true;
  }

  static async getSeasonsForShow(profile_id: string, show_id: string) {
    const query = 'SELECT * FROM profile_seasons where profile_id = ? and show_id = ? ORDER BY season_number';
    const [rows] = await pool.execute(query, [Number(profile_id), Number(show_id)]);
    const results = rows as any[];
    const promises = results.map(async (result) => {
      const season = result;
      const episodes = await Episode.getEpisodesForSeason(profile_id, season.season_id);
      season.episodes = episodes;
      return season;
    });
    const seasons = await Promise.all(promises);
    return seasons;
  }
}

export default Season;
