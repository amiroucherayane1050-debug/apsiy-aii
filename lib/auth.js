import { getSupabaseAdmin } from "./supabase-admin.js";

function bearerToken(req) {
  const header = req.headers.authorization;

  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim() || null;
}

export async function requireUser(req, res) {
  const token = bearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Connecte-toi pour continuer." });
    return null;
  }

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Ta session a expiré. Reconnecte-toi." });
    return null;
  }

  return user;
}
