import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../utils/http.js";

const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads/avatars");
const upload = multer({ dest: uploadDir });
const router = Router();

router.use(authMiddleware);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatar: true,
        bio: true,
        isOnline: true,
        lastSeen: true
      }
    });
    if (!user) throw new HttpError(404, "User not found");
    res.json(user);
  })
);

router.patch(
  "/me",
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        username: z.string().min(3).max(24).optional(),
        bio: z.string().max(280).optional(),
        displayName: z.string().max(60).optional()
      })
      .parse(req.body);

    try {
      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          username: body.username?.trim().toLowerCase(),
          bio: body.bio,
          displayName: body.displayName?.trim(),
          avatar: req.file ? `/uploads/avatars/${req.file.filename}` : undefined
        },
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          avatar: true,
          bio: true,
          isOnline: true,
          lastSeen: true
        }
      });

      res.json(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Username is already taken");
      }
      throw error;
    }
  })
);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = z.string().optional().parse(req.query.q);
    const users = await prisma.user.findMany({
      where: {
        username: query ? { contains: query, mode: "insensitive" } : undefined,
        id: { not: req.user!.id }
      },
      take: 20,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatar: true,
        bio: true,
        isOnline: true,
        lastSeen: true
      }
    });
    res.json(users);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatar: true,
        bio: true,
        isOnline: true,
        lastSeen: true
      }
    });
    if (!user) throw new HttpError(404, "User not found");
    res.json(user);
  })
);

export default router;
