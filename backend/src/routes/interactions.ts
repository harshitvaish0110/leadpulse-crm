import { Router } from "express";
import {
  createInteraction,
  deleteInteraction,
  getAllInteractions,
  getInteractionById,
  updateInteraction,
} from "../controllers/interactionsController";

const router = Router();

router.get("/", getAllInteractions);
router.get("/:id", getInteractionById);
router.post("/", createInteraction);
router.put("/:id", updateInteraction);
router.delete("/:id", deleteInteraction);

export default router;
