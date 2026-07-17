"use server";

import { redirect } from "next/navigation";
import { createSession, deleteSession, hashPassword, isUnclaimedPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function login(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || isUnclaimedPassword(user.passwordHash) || !verifyPassword(password, user.passwordHash)) {
    redirect("/login?error=Invalid+username+or+password");
  }
  await createSession(user.id);
  redirect("/");
}

export async function claimAccount(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 10 || password !== confirm) {
    redirect("/login?error=Passwords+must+match+and+be+at+least+10+characters");
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !isUnclaimedPassword(user.passwordHash)) {
    redirect("/login?error=That+account+cannot+be+claimed");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(password) },
  });
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
