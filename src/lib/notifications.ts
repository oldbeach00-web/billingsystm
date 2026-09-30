import { db } from "@/lib/db";
import type { Notification } from "@/types/database";

export async function getNotifications(): Promise<Notification[]> {
  try {
    const { data: userData, error: userError } = await db.auth.getUser();

    if (userError || !userData.user) {
      return [];
    }

    const { data, error } = await db
      .from("notifications")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data) {
      return [];
    }

    return data as Notification[];
  } catch {
    return [];
  }
}

export async function getUnreadNotificationCount(): Promise<number> {
  try {
    const { data: userData, error: userError } = await db.auth.getUser();

    if (userError || !userData.user) {
      return 0;
    }

    const { data, error } = await db
      .from("notifications")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("is_read", false);

    if (error || !data) {
      return 0;
    }

    return data.length;
  } catch {
    return 0;
  }
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<boolean> {
  try {
    const { data: userData, error: userError } = await db.auth.getUser();

    if (userError || !userData.user) {
      return false;
    }

    const { error } = await db
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .eq("user_id", userData.user.id);

    return !error;
  } catch {
    return false;
  }
}

export async function markAllNotificationsAsRead(): Promise<boolean> {
  try {
    const { data: userData, error: userError } = await db.auth.getUser();

    if (userError || !userData.user) {
      return false;
    }

    const { error } = await db
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userData.user.id)
      .eq("is_read", false);

    return !error;
  } catch {
    return false;
  }
}

export async function createErrorNotification(
  title: string,
  message: string
): Promise<boolean> {
  try {
    const { data: userData, error: userError } = await db.auth.getUser();

    if (userError || !userData.user) {
      return false;
    }

    const safeTitle = title.trim().slice(0, 200);
    const safeMessage = message.trim().slice(0, 1000);

    if (!safeTitle || !safeMessage) {
      return false;
    }

    const { error } = await db.from("notifications").insert({
      user_id: userData.user.id,
      type: "error",
      title: safeTitle,
      message: safeMessage,
      is_read: false,
    });

    return !error;
  } catch {
    return false;
  }
}