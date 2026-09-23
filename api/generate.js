import { randomUUID } from "node:crypto";

import { fal } from "@fal-ai/client";

import { requireUser } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";

async function refundGeneration(supabase, userId, jobId) {
  const { error: refundError } = await supabase.rpc("refund_credit", {
    p_user_id: userId,
    p_external_id: `refund:generation:${jobId}`,
  });

  if (refundError) {
    console.error("Unable to refund generation", refundError);
    return false;
  }

  await supabase
    .from("video_jobs")
    .update({ credit_refunded: true, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId);

  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

    if (prompt.length < 3) {
      return res.status(400).json({
        error: "Ajoute une description pour générer la vidéo.",
      });
    }

    if (prompt.length > 2_000) {
      return res.status(400).json({
        error: "La description est trop longue (2 000 caractères maximum).",
      });
    }

    if (!process.env.FAL_KEY) {
      throw new Error("FAL_KEY manquant.");
    }

    const supabase = getSupabaseAdmin();
    const jobId = randomUUID();
    const { data: remainingCredits, error: debitError } = await supabase.rpc(
      "consume_credit",
      {
        p_user_id: user.id,
        p_external_id: `generation:${jobId}`,
      },
    );

    if (debitError) {
      console.error("Unable to debit credit", debitError);
      return res.status(503).json({
        error: "Le débit du crédit est momentanément indisponible.",
      });
    }

    const balance = Number(remainingCredits);

    if (!Number.isInteger(balance)) {
      console.error("Invalid balance returned by consume_credit", remainingCredits);
      return res.status(503).json({
        error: "Le solde de crédits est momentanément indisponible.",
      });
    }

    if (balance < 0) {
      return res.status(402).json({
        error: "Tu n’as plus de crédits. Achète un pack pour continuer.",
      });
    }

    const { error: jobError } = await supabase.from("video_jobs").insert({
      id: jobId,
      user_id: user.id,
      prompt,
      status: "IN_QUEUE",
    });

    if (jobError) {
      console.error("Unable to create video job", jobError);
      await refundGeneration(supabase, user.id, jobId);
      return res.status(503).json({
        error: "La génération n’a pas pu démarrer. Ton crédit a été remboursé.",
      });
    }

    try {
      fal.config({ credentials: process.env.FAL_KEY });

      const { request_id: requestId } = await fal.queue.submit(MODEL, {
        input: {
          prompt,
          duration: "5",
          aspect_ratio: "9:16",
          generate_audio: false,
        },
      });

      if (!requestId) {
        throw new Error("fal.ai n’a pas renvoyé de request_id.");
      }

      const { error: updateError } = await supabase
        .from("video_jobs")
        .update({
          request_id: requestId,
          status: "IN_QUEUE",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      return res.status(202).json({
        jobId,
        status: "IN_QUEUE",
        remainingCredits: balance,
      });
    } catch (error) {
      console.error("fal.ai submission failed", error);
      const refunded = await refundGeneration(supabase, user.id, jobId);

      await supabase
        .from("video_jobs")
        .update({ status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("user_id", user.id);

      return res.status(502).json({
        error: refunded
          ? "La génération a échoué. Ton crédit a été remboursé."
          : "La génération a échoué. Contacte le support pour ton crédit.",
      });
    }
  } catch (error) {
    console.error("Generation endpoint failed", error);
    return res.status(503).json({
      error: "La génération est momentanément indisponible.",
    });
  }
}
