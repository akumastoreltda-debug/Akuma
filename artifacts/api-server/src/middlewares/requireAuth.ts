import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export type AuthenticatedRequest = Request & { userId?: string };

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const auth = getAuth(req);
  const userId = auth.userId;

  if (!userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  (req as AuthenticatedRequest).userId = userId;
  next();
}

export function getAuthenticatedUserId(req: Request): string {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    throw new Error("Authenticated request is missing a user id");
  }
  return userId;
}
