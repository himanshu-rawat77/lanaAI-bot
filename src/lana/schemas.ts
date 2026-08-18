import { z } from "zod";

export const AddressProfileResponseSchema = z.object({
  riskScore: z.number().min(0).max(100).default(50),
  reputation: z.enum(["low", "medium", "high", "unknown"]).default("unknown"),
  narrative: z.string().min(1),
  labels: z.array(z.string()).default([]),
  topCounterparties: z.array(z.string()).default([]),
  firstActivityDate: z.string().default("Unknown")
});

export const TxExplanationSchema = z.object({
  summary: z.string().min(1),
  tokenMovements: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([])
});

export type AddressProfileResponse = z.infer<typeof AddressProfileResponseSchema>;
export type TxExplanationResponse = z.infer<typeof TxExplanationSchema>;
