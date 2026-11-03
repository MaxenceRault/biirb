import { clearNotificationsController, listNotificationsController } from "@/server/controllers/notification.controller";

export const GET = listNotificationsController;
export const DELETE = clearNotificationsController;
