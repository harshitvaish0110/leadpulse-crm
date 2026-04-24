import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { prisma } from "./prismaClient";
import leadsRouter from "./routes/leads";
import interactionsRouter from "./routes/interactions";

dotenv.config();

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "leadpulse-backend" });
});

app.use("/api/leads", leadsRouter);
app.use("/api/interactions", interactionsRouter);

app.use((err: Error, _req: Request, res: Response, _next: Function) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`LeadPulse backend listening on http://localhost:${port}`);
});
