import { requireUser } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

const HISTORY_LIMIT = 12;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("video_jobs")
      .select("id,prompt,status,video_url,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error) throw error;

    return res.status(200).json({
      items: (data || []).map((item) => ({
        id: item.id,
        prompt: item.prompt,
        status: item.status,
        videoUrl: item.video_url,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    console.error("Unable to load video history", error);
    return res.status(503).json({
      error: "L’historique est momentanément indisponible.",
    });
  }
}
