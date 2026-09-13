import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { signedInUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SignUpLayout({ children }: { children: ReactNode }) {
  if (await signedInUserId()) redirect("/");
  return children;
}
