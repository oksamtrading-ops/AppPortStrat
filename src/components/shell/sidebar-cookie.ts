/**
 * Sidebar collapse-state cookie name. Lives in a plain module (no
 * "use client") so the server layout can read the actual string — exports of
 * client modules become opaque client references in server components.
 */
export const SIDEBAR_COOKIE = "aps_sidebar_collapsed";
