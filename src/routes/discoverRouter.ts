import { discoverChangesContent, discoverTopContent, discoverTrendingContent } from '../controllers/discoverController';
import { validateSchema } from '../middleware/validationMiddleware';
import {
  discoverChangesQuerySchema,
  discoverTopQuerySchema,
  discoverTrendingQuerySchema,
} from '../schema/discoverSchema';
import express from 'express';

const router = express.Router();

router.get('/api/v1/discover/top', validateSchema(discoverTopQuerySchema, 'query'), discoverTopContent);
router.get('/api/v1/discover/changes', validateSchema(discoverChangesQuerySchema, 'query'), discoverChangesContent);
router.get('/api/v1/discover/trending', validateSchema(discoverTrendingQuerySchema, 'query'), discoverTrendingContent);

export default router;
