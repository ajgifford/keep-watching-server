import { axiosTMDBAPIInstance } from '../utils/axiosInstance';
import { generateGenreArrayFromIds } from '../utils/genreUtility';
import { buildTMDBImagePath } from '../utils/imageUtility';
import { Request, Response } from 'express';

export const searchShows = async (req: Request, res: Response) => {
  const searchString = req.query.searchString;
  console.log(`GET /api/search/shows`, req.query);

  const response = await axiosTMDBAPIInstance.get(`/search/tv?query=${searchString}`);
  const results: any[] = response.data.results;
  const searchResult = results.map((result) => {
    return {
      id: result.id,
      title: result.name,
      genres: generateGenreArrayFromIds(result.genre_ids),
      premiered: result.first_air_date,
      summary: result.overview,
      image: buildTMDBImagePath(result.poster_path),
      rating: result.vote_average,
    };
  });

  res.status(200).json({ results: searchResult });
};

export const searchMovies = async (req: Request, res: Response) => {
  const searchString = req.query.searchString;
  console.log(`GET /api/search/movies`, req.query);

  const response = await axiosTMDBAPIInstance.get(`/search/movie?query=${searchString}&region=US`);
  const results: any[] = response.data.results;
  const searchResult = results.map((result) => {
    return {
      id: result.id,
      title: result.title,
      genres: generateGenreArrayFromIds(result.genre_ids),
      premiered: result.release_date,
      summary: result.overview,
      image: buildTMDBImagePath(result.poster_path),
      rating: result.vote_average,
    };
  });

  res.status(200).json({ results: searchResult });
};
