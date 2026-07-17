"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthMode } from "./mode";

/** Dev-mode only: switch the signed dev-user cookie. */
export async function switchDevUser(formData: FormData) {
  if (getAuthMode() !== "dev") throw new Error("Dev auth is not enabled");
  const { createDevCookieValue, DEV_COOKIE_NAME, DEV_USERS } = await import("./dev");
  const userId = String(formData.get("userId") ?? "");
  if (!DEV_USERS.some((u) => u.id === userId)) throw new Error("Unknown dev user");
  const store = await cookies();
  store.set(DEV_COOKIE_NAME, createDevCookieValue(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/select-engagement");
}

export async function devSignOut() {
  if (getAuthMode() !== "dev") throw new Error("Dev auth is not enabled");
  const { DEV_COOKIE_NAME } = await import("./dev");
  const store = await cookies();
  store.delete(DEV_COOKIE_NAME);
  redirect("/sign-in");
}
