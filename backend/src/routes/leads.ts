import { Router } from "express";
import {
  createLead,
  deleteLead,
  getAllLeads,
  getLeadById,
  updateLead,
} from "../controllers/leadsController";

const router = Router();

router.get("/", getAllLeads);
router.get("/:id", getLeadById);
router.post("/", createLead);
router.put("/:id", updateLead);
router.delete("/:id", deleteLead);

export default router;
