import { subscribePushController, unsubscribePushController } from "@/server/controllers/notification.controller";

export const POST = subscribePushController;
export const DELETE = unsubscribePushController;
