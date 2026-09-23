import { requireUser } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("profiles")
      .upsert({ user_id: user.id }, { onConflict: "user_id" })
      .select("credits")
      .single();

    if (error) {
      console.error("Unable to read profile", error);
      return res.status(503).json({
        error: "Le solde de crédits est momentanément indisponible.",
      });
    }

    return res.status(200).json({
      email: user.email || null,
      credits: data.credits,
    });
  } catch (error) {
    console.error("Account endpoint failed", error);
    return res.status(503).json({
      error: "Le compte est momentanément indisponible.",
    });
  }
}
