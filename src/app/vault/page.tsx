import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/session";
import { VaultApp } from "@/components/vault/vault-app";

export const metadata: Metadata = { title: "Vault" };

export default async function VaultPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <VaultApp username={user.username} />;
}
