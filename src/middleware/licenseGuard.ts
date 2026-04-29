import { Request, Response, NextFunction } from "express";
import { getStatus } from "../license/manager";

export function licenseGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/license")) {
    next();
    return;
  }
  const { status } = getStatus();
  if (status === "valid") {
    next();
    return;
  }
  res.status(503).json({ error: "5005" });
}
