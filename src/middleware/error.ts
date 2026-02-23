import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/http.js";

export const notFound = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new HttpError(404, "Not Found"));
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message, ...(error.details ?? {}) });
    return;
  }

  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "Validation error";
    res.status(400).json({ message });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Internal server error" });
};
