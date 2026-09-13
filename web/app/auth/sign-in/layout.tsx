import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { signedInUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SignInLayout({ children }: { children: ReactNode }) {
  // Neon Auth middleware always allows its own login route, even for signed-in users.
  // This request-time session check is therefore what keeps the form out of view.
  if (await signedInUserId()) redirect("/");
  return children;
}
