import { deleteMeController, getMeController, updateMeController } from "@/server/controllers/user.controller";

export const GET = getMeController;
export const PATCH = updateMeController;
export const DELETE = deleteMeController;
