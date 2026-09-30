"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Menu,
  Bell,
  User,
  LogOut,
  ChevronDown,
  AlertCircle,
  Check,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import type { UserProfile, Notification } from "@/types/database";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/notifications";

interface HeaderProps {
  onMobileMenuToggle: () => void;
  title?: string;
}

export function Header({
  onMobileMenuToggle,
  title = "Dashboard",
}: HeaderProps) {
  const router = useRouter();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setTimeout(
      () =>
        setUser({
          id: "mock-user-id",
          email: "user@example.com",
          full_name: "Admin User",
          role: "admin",
          phone: null,
          avatar_url: null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      0
    );
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadNotificationCount = async () => {
      const count = await getUnreadNotificationCount();

      if (isMounted) {
        setUnreadCount(count);
      }
    };

    void loadNotificationCount();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleNotificationOpen = async () => {
    setIsNotificationOpen((prev) => !prev);
    setIsUserMenuOpen(false);

    if (!isNotificationOpen) {
      const data = await getNotifications();
      setNotifications(data);

      const count = await getUnreadNotificationCount();
      setUnreadCount(count);
    }
  };

  const handleNotificationRead = async (notification: Notification) => {
    if (!notification.is_read) {
      const success = await markNotificationAsRead(notification.id);

      if (success) {
        setNotifications((prev) =>
          prev.map((item) =>
            item.id === notification.id
              ? { ...item, is_read: true }
              : item
          )
        );

        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    }
  };

  const handleMarkAllRead = async () => {
    const success = await markAllNotificationsAsRead();

    if (success) {
      setNotifications((prev) =>
        prev.map((notification) => ({
          ...notification,
          is_read: true,
        }))
      );

      setUnreadCount(0);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore errors on logout
    }

    router.push("/login");
  };

  const initials = user?.full_name
    ? getInitials(user.full_name)
    : user?.email?.slice(0, 2).toUpperCase() ?? "U";

  return (
    <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
      {/* Left: Mobile menu button + Page title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <h1 className="text-lg font-semibold text-gray-900 dark:text-white hidden sm:block">
          {title}
        </h1>
      </div>

      {/* Right: Notifications + User menu */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => void handleNotificationOpen()}
            className="relative p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Notifications"
            aria-expanded={isNotificationOpen}
          >
            <Bell className="w-5 h-5" />

            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {isNotificationOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsNotificationOpen(false)}
                aria-hidden="true"
              />

              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Notifications
                    </h3>

                    {unreadCount > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {unreadCount} unread
                      </p>
                    )}
                  </div>

                  {unreadCount > 0 && (
                    <button
                      onClick={() => void handleMarkAllRead()}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                {/* Notifications list */}
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Bell className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />

                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        No notifications
                      </p>
                    </div>
                  ) : (
                    notifications.map((notification) => (
                      <button
                        key={notification.id}
                        onClick={() =>
                          void handleNotificationRead(notification)
                        }
                        className={cn(
                          "w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors",
                          !notification.is_read &&
                            "bg-red-50/50 dark:bg-red-900/10"
                        )}
                      >
                        <div className="flex gap-3">
                          <div
                            className={cn(
                              "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                              notification.type === "error"
                                ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                : notification.type === "warning"
                                  ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400"
                                  : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            )}
                          >
                            {notification.type === "error" ? (
                              <AlertCircle className="w-4 h-4" />
                            ) : (
                              <Bell className="w-4 h-4" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className={cn(
                                  "text-sm text-gray-900 dark:text-white",
                                  !notification.is_read && "font-semibold"
                                )}
                              >
                                {notification.title}
                              </p>

                              {!notification.is_read && (
                                <span className="w-2 h-2 mt-1.5 flex-shrink-0 bg-red-500 rounded-full" />
                              )}
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                              {notification.message}
                            </p>

                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                              {new Date(
                                notification.created_at
                              ).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Footer */}
                {notifications.length > 0 && (
                  <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-center gap-1 text-[11px] text-gray-400">
                      <Check className="w-3 h-3" />
                      Click a notification to mark it as read
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => {
              setIsUserMenuOpen((prev) => !prev);
              setIsNotificationOpen(false);
            }}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="User menu"
            aria-expanded={isUserMenuOpen}
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-semibold">
              {user?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar_url}
                  alt={user.full_name ?? "User avatar"}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>

            {/* Name */}
            <span className="hidden md:block text-sm font-medium text-gray-700 dark:text-gray-200 max-w-[120px] truncate">
              {user?.full_name ?? user?.email ?? "User"}
            </span>

            <ChevronDown
              className={cn(
                "hidden md:block w-4 h-4 text-gray-400 transition-transform duration-200",
                isUserMenuOpen && "rotate-180"
              )}
            />
          </button>

          {/* Dropdown */}
          {isUserMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsUserMenuOpen(false)}
                aria-hidden="true"
              />

              <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
                {/* User info */}
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {user?.full_name ?? "User"}
                  </p>

                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {user?.email}
                  </p>

                  <span className="inline-flex items-center mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 capitalize">
                    {user?.role ?? "staff"}
                  </span>
                </div>

                {/* Menu items */}
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    router.push("/dashboard/settings");
                  }}
                >
                  <User className="w-4 h-4" />
                  Profile & Settings
                </button>

                <button
                  disabled={isLoggingOut}
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  <LogOut className="w-4 h-4" />
                  {isLoggingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}