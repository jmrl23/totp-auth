import Link from "next/link";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AuthFrame>
      <AuthHeading title="This page does not exist" lead="The address may be mistyped, or the page has moved." />
      <Button asChild size="lg" className="w-full">
        <Link href="/vault">Go to your vault</Link>
      </Button>
    </AuthFrame>
  );
}
