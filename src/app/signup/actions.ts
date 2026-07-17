"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function signup(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) redirect("/signup?error=Username+must+be+3-24+letters,+numbers,+underscores,+or+dashes");
  if (password.length < 10 || password !== confirm) redirect("/signup?error=Passwords+must+match+and+be+at+least+10+characters");
  if (await prisma.user.findUnique({ where: { username } })) redirect("/signup?error=Username+already+exists");
  const user = await prisma.user.create({ data: { username, passwordHash: hashPassword(password) } });
  await createSession(user.id);
  redirect("/leagues");
}
