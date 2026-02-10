/**
 * RESPONSIBILITY:
 * Defines authentication routes
 */
import { Router } from 'express';
import { AuthController } from '../controllers/authController.js';
import "dotenv/config";
export function createAuthRoutes(metaService) {
    const router = Router();
    const authController = new AuthController(metaService);
    router.get('/callback', (req, res) => authController.handleCallback(req, res));
    return router;
}
