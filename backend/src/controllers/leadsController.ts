import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { Source, Status } from "@prisma/client";

interface CreateLeadBody {
  name: string;
  email: string;
  companyName: string;
  industry: string;
  companySize: number;
  source: Source;
  status: Status;
}

interface UpdateLeadBody extends Partial<CreateLeadBody> {
  conversionScore?: number;
  lastContactedAt?: string;
}

export const getAllLeads = async (_req: Request, res: Response) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { name: "asc" },
      include: {
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve leads." });
  }
};

export const getLeadById = async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        interactions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found." });
    }

    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve lead." });
  }
};

export const createLead = async (req: Request<{}, {}, CreateLeadBody>, res: Response) => {
  const { name, email, companyName, industry, companySize, source, status } = req.body;

  if (!name || !email || !companyName || !industry || !companySize || !source || !status) {
    return res.status(400).json({ error: "Missing required lead fields." });
  }

  try {
    const createdLead = await prisma.lead.create({
      data: {
        name,
        email,
        companyName,
        industry,
        companySize,
        source,
        status,
        conversionScore: 0,
      },
    });

    res.status(201).json(createdLead);
  } catch (error) {
    res.status(500).json({ error: "Unable to create lead." });
  }
};

export const updateLead = async (req: Request<{ id: string }, {}, UpdateLeadBody>, res: Response) => {
  try {
    const updatedLead = await prisma.lead.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json(updatedLead);
  } catch (error) {
    res.status(500).json({ error: "Unable to update lead." });
  }
};

export const deleteLead = async (req: Request, res: Response) => {
  try {
    await prisma.lead.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Unable to delete lead." });
  }
};
