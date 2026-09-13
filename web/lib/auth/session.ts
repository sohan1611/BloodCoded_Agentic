import { getNeonAuth } from "./server";

export async function signedInUserId(): Promise<string | null> {
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) {
    return null;
  }

  try {
    const { data } = await getNeonAuth().getSession();
    return data?.user.id ?? null;
  } catch {
    return null;
  }
}
