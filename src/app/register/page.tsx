import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/session";
import { AuthFrame } from "@/components/auth/auth-frame";
import { RegisterFlow } from "@/components/auth/register-flow";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/vault");
  return (
    <AuthFrame>
      <RegisterFlow />
    </AuthFrame>
  );
}
