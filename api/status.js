import { fal } from "@fal-ai/client";

import { requireUser } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";
const FAILED_STATUSES = new Set(["FAILED", "CANCELLED", "ERROR"]);

async function refundFailedJob(supabase, job) {
  if (job.credit_refunded) return true;

  const { error } = await supabase.rpc("refund_credit", {
    p_user_id: job.user_id,
    p_external_id: `refund:generation:${job.id}`,
  });

  if (error) {
    console.error("Unable to refund failed job", error);
    return false;
  }

  await supabase
    .from("video_jobs")
    .update({ credit_refunded: true, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("user_id", job.user_id);

  return true;
}

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

    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
    if (!jobId) {
      return res.status(400).json({ error: "jobId manquant" });
    }

    const supabase = getSupabaseAdmin();
    const { data: job, error: jobError } = await supabase
      .from("video_jobs")
      .select("id,user_id,request_id,status,video_url,credit_refunded")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) {
      return res.status(404).json({ error: "Génération introuvable." });
    }

    if (job.status === "COMPLETED" && job.video_url) {
      return res.status(200).json({ status: "COMPLETED", video: job.video_url });
    }

    if (FAILED_STATUSES.has(job.status)) {
      const refunded = await refundFailedJob(supabase, job);
      return res.status(200).json({
        status: "FAILED",
        error: refunded
          ? "La génération a échoué. Le crédit a été remboursé."
          : "La génération a échoué. Contacte le support pour ton crédit.",
      });
    }

    if (!job.request_id) {
      return res.status(200).json({ status: "IN_QUEUE" });
    }

    if (!process.env.FAL_KEY) {
      throw new Error("FAL_KEY manquant.");
    }

    fal.config({ credentials: process.env.FAL_KEY });
    const providerStatus = await fal.queue.status(MODEL, {
      requestId: job.request_id,
      logs: false,
    });
    const status = String(providerStatus.status || "IN_QUEUE").toUpperCase();

    if (FAILED_STATUSES.has(status)) {
      await supabase
        .from("video_jobs")
        .update({ status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("user_id", user.id);

      const refunded = await refundFailedJob(supabase, {
        ...job,
        status: "FAILED",
      });

      return res.status(200).json({
        status: "FAILED",
        error: refunded
          ? "La génération a échoué. Le crédit a été remboursé."
          : "La génération a échoué. Contacte le support pour ton crédit.",
      });
    }

    if (status !== "COMPLETED") {
      await supabase
        .from("video_jobs")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("user_id", user.id);

      return res.status(200).json({ status });
    }

    const result = await fal.queue.result(MODEL, { requestId: job.request_id });
    const videoUrl = result.data?.video?.url || null;

    if (!videoUrl) {
      throw new Error("La réponse fal.ai ne contient aucune vidéo.");
    }

    const { error: updateError } = await supabase
      .from("video_jobs")
      .update({
        status: "COMPLETED",
        video_url: videoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    return res.status(200).json({ status: "COMPLETED", video: videoUrl });
  } catch (error) {
    console.error("Unable to check generation", error);
    return res.status(502).json({
      error: "Impossible de vérifier la génération pour le moment.",
    });
  }
}
