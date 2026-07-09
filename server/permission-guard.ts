import type { Request, Response } from "express";
import { hasPermission, type Permission } from "@shared/permissions";

/** Use at the top of permission-gated API handlers. Returns false after sending 401/403. */
export function requirePermission(req: Request, res: Response, permission: Permission): boolean {
  if (!req.currentUser) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  if (!hasPermission(req.currentUser.role, permission)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}
