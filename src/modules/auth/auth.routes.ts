import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { createHash } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { asyncHandler, HttpError } from "../../utils/http.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { isPrismaKnownRequestError } from "../../utils/prisma.js";

const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads/avatars");
const upload = multer({ dest: uploadDir });
const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(24),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const isProd = env.NODE_ENV === "production";

const setAccessCookie = (res: import("express").Response, accessToken: string): void => {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    maxAge: 15 * 60 * 1000
  });
};

router.post(
  "/register",
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const username = body.username.trim().toLowerCase();
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }]
      },
      select: { id: true, username: true, email: true }
    });
    if (existing) {
      throw new HttpError(409, existing.username === username ? "Username already taken" : "Email already taken");
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    let created;
    try {
      created = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          displayName: body.username.trim(),
          avatar: req.file ? `/uploads/avatars/${req.file.filename}` : null
        }
      });
    } catch (error) {
      if (isPrismaKnownRequestError(error) && error.code === "P2002") {
        throw new HttpError(409, "Username or email already taken");
      }
      throw error;
    }

    const accessToken = signAccessToken(created);
    const refreshToken = signRefreshToken(created);
    const refreshHash = createHash("sha256").update(refreshToken).digest("hex");

    await prisma.refreshToken.create({
      data: {
        tokenHash: refreshHash,
        userId: created.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS)
      }
    });

    setAccessCookie(res, accessToken);
    res.status(201).json({
      user: {
        id: created.id,
        username: created.username,
        email: created.email,
        displayName: created.displayName,
        avatar: created.avatar,
        bio: created.bio,
        isOnline: created.isOnline,
        lastSeen: created.lastSeen
      },
      accessToken,
      refreshToken
    });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(401, "Invalid credentials");
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      throw new HttpError(401, "Invalid credentials");
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    const refreshHash = createHash("sha256").update(refreshToken).digest("hex");

    await prisma.refreshToken.create({
      data: {
        tokenHash: refreshHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS)
      }
    });

    setAccessCookie(res, accessToken);
    res.json({ accessToken, refreshToken });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const schema = z.object({ refreshToken: z.string().min(1) });
    const { refreshToken } = schema.parse(req.body);
    const parsed = verifyRefreshToken(refreshToken);
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new HttpError(401, "Refresh token expired");
    }

    await prisma.refreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } });

    const user = await prisma.user.findUnique({ where: { id: parsed.id } });
    if (!user) {
      throw new HttpError(401, "User not found");
    }

    const nextAccessToken = signAccessToken(user);
    const nextRefreshToken = signRefreshToken(user);
    const nextHash = createHash("sha256").update(nextRefreshToken).digest("hex");

    await prisma.refreshToken.create({
      data: {
        tokenHash: nextHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS)
      }
    });

    setAccessCookie(res, nextAccessToken);
    res.json({ accessToken: nextAccessToken, refreshToken: nextRefreshToken });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const schema = z.object({ refreshToken: z.string().optional() });
    const { refreshToken } = schema.parse(req.body ?? {});
    if (refreshToken) {
      const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
      await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
    }
    res.clearCookie("accessToken", {
      path: "/",
      sameSite: isProd ? "none" : "lax",
      secure: isProd
    });
    res.status(204).send();
  })
);

export default router;
