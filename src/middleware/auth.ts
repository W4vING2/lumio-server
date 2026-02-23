import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http.js";
import { verifyAccessToken } from "../utils/jwt.js";

export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const cookieToken = req.cookies.accessToken as string | undefined;
  const token = headerToken ?? cookieToken;

  if (!token) {
    next(new HttpError(401, "Unauthorized"));
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new HttpError(401, "Invalid token"));
  }
};
