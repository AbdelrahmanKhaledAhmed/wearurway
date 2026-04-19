import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

router.post("/ai/select-assist", async (req, res) => {
  try {
    const { imageBase64, prompt, width, height } = req.body as {
      imageBase64: string;
      prompt: string;
      width: number;
      height: number;
    };

    if (!imageBase64 || !prompt) {
      res.status(400).json({ error: "Missing imageBase64 or prompt" });
      return;
    }

    const systemPrompt = `You are a world-class AI image editing engine, like Adobe Firefly or Remove.bg, embedded in a professional design tool.

The user uploads an image and tells you what they want to remove or keep. Your job is to identify the EXACT pixel regions to erase, using normalized coordinates (0.0–1.0).

You MUST respond ONLY with valid JSON — no markdown, no code fences, no explanation outside the JSON:
{
  "message": "Short, confident confirmation of what you found and what action you are taking (1-2 sentences max)",
  "seedPoints": [
    { "x": 0.05, "y": 0.05 },
    { "x": 0.50, "y": 0.02 }
  ],
  "tolerance": 38,
  "edgeTolerance": 50,
  "hint": "Optional short tip for refining edges, or null"
}

CRITICAL RULES:
- seedPoints are normalized (0.0–1.0) x,y coordinates of pixels IN THE AREA TO REMOVE/ERASE
- Provide 8–15 seed points that cover the full region to remove (more = better coverage)
- Spread seeds across the entire area — corners, center, edges of the target region
- tolerance (5–120): lower = precise color match, higher = broader. Uniform bg → 25-45, complex/gradient bg → 55-85, mixed colors → 45-65
- edgeTolerance (10–250): stops at pixel edges. Use 30-60 for sharp-edged subjects, 80-150 for soft/hair/fur edges
- If the user says "remove background": identify background pixels far from the subject, spread seeds in all background zones
- If the user says "keep subject" or "remove everything except X": seeds go on the background areas
- message should sound confident and modern, like a professional AI tool
- hint may suggest a refinement action, or null if not needed`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 700,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: `Image dimensions: ${width}×${height}px. User request: "${prompt}"\n\nAnalyze the image carefully and return the JSON with seed points covering the area to be removed/erased.`,
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    let parsed: {
      message?: string;
      seedPoints?: { x: number; y: number }[];
      tolerance?: number;
      edgeTolerance?: number;
      hint?: string;
    } = {};

    try {
      const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        message: "I analyzed your image. Try describing the area you want to remove more specifically.",
        seedPoints: [],
        tolerance: 40,
        edgeTolerance: 60,
      };
    }

    res.json({
      message: parsed.message ?? "Done — check the result and refine if needed.",
      seedPoints: (parsed.seedPoints ?? []).map((p) => ({
        x: Math.max(0, Math.min(1, p.x)),
        y: Math.max(0, Math.min(1, p.y)),
      })),
      tolerance:     Math.max(5,  Math.min(120, parsed.tolerance     ?? 40)),
      edgeTolerance: Math.max(10, Math.min(250, parsed.edgeTolerance ?? 60)),
      hint: parsed.hint ?? null,
    });
  } catch (err) {
    console.error("AI select assist error:", err);
    res.status(500).json({ error: "AI analysis failed. Please try again." });
  }
});

export default router;
