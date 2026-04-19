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

    const systemPrompt = `You are an expert AI image editing assistant inside a professional design tool similar to Photoshop.
The user will describe what they want to select or remove from an image.
Your job is to analyze the image carefully and return structured JSON data that the selection algorithm will use.

Respond ONLY with valid JSON in this exact format (no markdown, no explanation outside JSON):
{
  "message": "brief friendly explanation of what you found and what you'll select",
  "seedPoints": [
    { "x": 0.12, "y": 0.08 },
    { "x": 0.95, "y": 0.15 }
  ],
  "tolerance": 45,
  "edgeTolerance": 60,
  "hint": "optional tip for refining the selection"
}

Rules:
- seedPoints are normalized (0.0-1.0) x,y coordinates of representative pixels in the AREA TO SELECT/REMOVE
- Provide 1-6 seed points that cover the region the user wants to select
- tolerance (5-120): lower = more precise color matching, higher = selects wider color range. For uniform backgrounds use 25-45, for complex areas use 50-80
- edgeTolerance (10-200): lower = stops at sharp edges, higher = crosses softer edges
- message should be conversational and helpful, max 2 sentences
- hint should give a useful tip about refining with the manual tools`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: "low",
              },
            },
            {
              type: "text",
              text: `The image is ${width}x${height} pixels. User request: "${prompt}"`,
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
      // Strip markdown code fences if present
      const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        message: "I analyzed the image. Try clicking on the area you want to select, or describe it differently.",
        seedPoints: [],
        tolerance: 35,
        edgeTolerance: 40,
      };
    }

    res.json({
      message: parsed.message ?? "I found the area. Check the selection and refine as needed.",
      seedPoints: (parsed.seedPoints ?? []).map((p) => ({
        x: Math.max(0, Math.min(1, p.x)),
        y: Math.max(0, Math.min(1, p.y)),
      })),
      tolerance: Math.max(5, Math.min(120, parsed.tolerance ?? 35)),
      edgeTolerance: Math.max(10, Math.min(200, parsed.edgeTolerance ?? 40)),
      hint: parsed.hint ?? null,
    });
  } catch (err) {
    console.error("AI select assist error:", err);
    res.status(500).json({ error: "AI analysis failed. Please try again." });
  }
});

export default router;
