import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/session";
import { AuthFrame } from "@/components/auth/auth-frame";
import { RecoverFlow } from "@/components/auth/recover-flow";

export const metadata: Metadata = { title: "Recover account" };

export default async function RecoverPage() {
  if (await getSessionUser()) redirect("/vault");
  return (
    <AuthFrame>
      <RecoverFlow />
    </AuthFrame>
  );
}
