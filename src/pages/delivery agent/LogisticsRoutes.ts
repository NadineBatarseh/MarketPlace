import { Router } from "express";
import {
  getPickupOrders,
  confirmPackagePickup,
  getHubBoard,
  receivePackageAtHub,
  consolidateOrder,
  getDeliveryOrders,
  startLastMileDelivery,
  completeLastMileDelivery,
  getCollectorRoute,
  getDelivererRoute,
  getBatches,
  assignBatches,
} from "./LogisticsController.js";

const router = Router();

// Phase 1 — First Mile (Collector)
router.get("/pickup", getPickupOrders);
router.patch("/pickup/confirm", confirmPackagePickup);

// Phase 2 — Hub (Organizer)
router.get("/hub", getHubBoard);
router.patch("/hub/receive", receivePackageAtHub);
router.post("/hub/consolidate", consolidateOrder);

// Phase 3 — Last Mile (Deliverer)
router.get("/delivery", getDeliveryOrders);
router.patch("/delivery/start", startLastMileDelivery);
router.patch("/delivery/complete", completeLastMileDelivery);

// Route Maps
router.post("/collector/route", getCollectorRoute);
router.post("/deliverer/route", getDelivererRoute);

// Batching
router.get("/batches", getBatches);

// Assignment
router.post("/assign", assignBatches);

export default router;
