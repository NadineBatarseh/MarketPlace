import { Router } from "express";
import { AuthController } from "../controllers/authController.js";
import { MetaService } from "../services/metaService.js";

export function createAuthRoutes(metaService: MetaService): Router {
  const router = Router();
  const controller = new AuthController(metaService);

  router.get("/callback", (req, res) => controller.handleCallback(req, res));

  return router;
}
