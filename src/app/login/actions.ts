"use server";

import { redirect } from "next/navigation";
import { createSession, deleteSession, isUnclaimedPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function login(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || isUnclaimedPassword(user.passwordHash) || !verifyPassword(password, user.passwordHash)) {
    redirect("/login?error=Invalid+username+or+password");
  }
  await createSession(user.id);
  redirect("/leagues");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
