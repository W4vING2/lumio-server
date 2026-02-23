import jwt from "jsonwebtoken";
import type { User } from "@prisma/client";
import { env } from "../config/env.js";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

type JwtUser = Pick<User, "id" | "username" | "email">;

interface TokenPayload extends AuthUser {
  type: "access" | "refresh";
}

export const signAccessToken = (user: JwtUser): string =>
  jwt.sign(
    { id: user.id, username: user.username, email: user.email, type: "access" } satisfies TokenPayload,
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as unknown as jwt.SignOptions["expiresIn"] }
  );

export const signRefreshToken = (user: JwtUser): string =>
  jwt.sign(
    { id: user.id, username: user.username, email: user.email, type: "refresh" } satisfies TokenPayload,
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES as unknown as jwt.SignOptions["expiresIn"] }
  );

export const verifyAccessToken = (token: string): AuthUser => {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
  return { id: payload.id, username: payload.username, email: payload.email };
};

export const verifyRefreshToken = (token: string): AuthUser => {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
  return { id: payload.id, username: payload.username, email: payload.email };
};
