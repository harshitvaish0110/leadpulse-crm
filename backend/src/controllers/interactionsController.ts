import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { InteractionType } from "@prisma/client";

interface CreateInteractionBody {
  leadId: string;
  type: InteractionType;
  notes: string;
  sentimentScore?: number;
}

interface UpdateInteractionBody extends Partial<CreateInteractionBody> {}

export const getAllInteractions = async (
  req: Request<{}, {}, {}, { leadId?: string }>,
  res: Response,
) => {
  try {
    const where = req.query.leadId ? { leadId: req.query.leadId } : undefined;

    const interactions = await prisma.interaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(interactions);
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve interactions." });
  }
};

export const getInteractionById = async (req: Request, res: Response) => {
  try {
    const interaction = await prisma.interaction.findUnique({
      where: { id: req.params.id },
    });

    if (!interaction) {
      return res.status(404).json({ error: "Interaction not found." });
    }

    res.json(interaction);
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve interaction." });
  }
};

export const createInteraction = async (
  req: Request<{}, {}, CreateInteractionBody>,
  res: Response,
) => {
  const { leadId, type, notes, sentimentScore } = req.body;

  if (!leadId || !type || !notes) {
    return res.status(400).json({ error: "Missing required interaction fields." });
  }

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      return res.status(404).json({ error: "Parent lead not found." });
    }

    const interaction = await prisma.interaction.create({
      data: {
        leadId,
        type,
        notes,
        sentimentScore: typeof sentimentScore === "number" ? sentimentScore : 0,
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    res.status(201).json(interaction);
  } catch (error) {
    res.status(500).json({ error: "Unable to create interaction." });
  }
};

export const updateInteraction = async (
  req: Request<{ id: string }, {}, UpdateInteractionBody>,
  res: Response,
) => {
  try {
    const updatedInteraction = await prisma.interaction.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json(updatedInteraction);
  } catch (error) {
    res.status(500).json({ error: "Unable to update interaction." });
  }
};

export const deleteInteraction = async (req: Request, res: Response) => {
  try {
    await prisma.interaction.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Unable to delete interaction." });
  }
};
