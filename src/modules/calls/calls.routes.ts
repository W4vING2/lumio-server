import { CallStatus, CallType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { asyncHandler } from "../../utils/http.js";

const router = Router();
router.use(authMiddleware);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z.object({ calleeId: z.string(), type: z.nativeEnum(CallType) }).parse(req.body);
    const call = await prisma.call.create({
      data: {
        callerId: req.user!.id,
        calleeId: body.calleeId,
        type: body.type,
        status: CallStatus.RINGING
      }
    });
    res.status(201).json(call);
  })
);

router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const body = z.object({ status: z.nativeEnum(CallStatus) }).parse(req.body);
    const call = await prisma.call.update({
      where: { id: req.params.id },
      data: {
        status: body.status,
        startedAt: body.status === CallStatus.ACTIVE ? new Date() : undefined,
        endedAt:
          body.status === CallStatus.ENDED || body.status === CallStatus.DECLINED || body.status === CallStatus.MISSED
            ? new Date()
            : undefined
      }
    });
    res.json(call);
  })
);

export default router;
