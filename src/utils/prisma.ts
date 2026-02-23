export const isPrismaKnownRequestError = (error: unknown): error is { code: string } => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string";
};
