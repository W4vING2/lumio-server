import bcrypt from "bcrypt";
import { prisma } from "../db/prisma.js";

const TEST_USERS = [
  {
    username: "alex",
    email: "alex@lumio.local",
    password: "Alex12345!",
    displayName: "Alex"
  },
  {
    username: "mila",
    email: "mila@lumio.local",
    password: "Mila12345!",
    displayName: "Mila"
  },
  {
    username: "leo",
    email: "leo@lumio.local",
    password: "Leo12345!",
    displayName: "Leo"
  }
] as const;

const run = async (): Promise<void> => {
  for (const user of TEST_USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        username: user.username,
        displayName: user.displayName,
        passwordHash,
        isEmailVerified: true,
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null
      },
      create: {
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        passwordHash,
        isEmailVerified: true
      }
    });
  }

  process.stdout.write("Seeded 3 test users.\n");
};

run()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
