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

    const systemPrompt = `You are a world-class AI image editing engine embedded in a professional design tool.
The user uploads an image and tells you what they want to remove or keep. Identify the EXACT pixel regions to erase, using normalized coordinates (0.0–1.0).

Respond ONLY with valid JSON:
{
  "message": "Short, confident confirmation of what you found (1-2 sentences)",
  "seedPoints": [{ "x": 0.05, "y": 0.05 }],
  "tolerance": 38,
  "edgeTolerance": 50,
  "hint": "Optional short tip for refining edges, or null"
}

RULES:
- seedPoints are normalized (0.0–1.0) x,y coordinates IN THE AREA TO REMOVE/ERASE
- Provide 8–15 seed points that cover the full region to remove
- tolerance (5–120): lower = precise, higher = broader
- edgeTolerance (10–250): stops at pixel edges`;

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
              image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" },
            },
            {
              type: "text",
              text: `Image dimensions: ${width}×${height}px. User request: "${prompt}"\n\nAnalyze the image carefully and return the JSON.`,
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
      parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      parsed = { message: "Try describing the area to remove more specifically.", seedPoints: [], tolerance: 40, edgeTolerance: 60 };
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

router.post("/ai/command", async (req, res) => {
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

    const systemPrompt = `You are an elite AI image editing assistant — on the level of Adobe Firefly, Google Gemini Vision, and professional studio tools. You analyze images deeply and execute precise editing commands.

You receive an image and a natural language editing request. You must:
1. Understand the full intent of the request
2. Choose the correct editing approach
3. Return a detailed plan and the exact parameters to execute it

You support these action types:

TYPE 1 — remove_pixels: Erase regions by flood-fill selection (background removal, object deletion, shadow removal)
TYPE 2 — adjust: Pixel-level tonal and color corrections (brightness, contrast, saturation, sharpening)
TYPE 3 — describe: Explain what you see in the image without making changes (if asked to "analyze", "describe", "what is in this image")

RESPOND ONLY with valid JSON in this exact format:
{
  "message": "Confident, professional 1–2 sentence explanation of what you understand and what you'll do",
  "intent": "remove_pixels" | "adjust" | "describe",
  "plan": ["Step 1 description", "Step 2 description", "Step 3 description"],
  "action": {
    /* For remove_pixels: */
    "type": "remove_pixels",
    "seedPoints": [{ "x": 0.05, "y": 0.05 }],
    "tolerance": 40,
    "edgeTolerance": 60

    /* OR for adjust: */
    "type": "adjust",
    "brightness": 0,
    "contrast": 0,
    "saturation": 0,
    "sharpen": false

    /* OR for describe: */
    "type": "describe"
  },
  "hint": "Optional tip for the user, or null"
}

REMOVE_PIXELS RULES:
- seedPoints: normalized (0.0–1.0) x,y coordinates IN THE AREA TO REMOVE/ERASE
- Provide 8–20 seed points spread across the ENTIRE target region
- tolerance (5–120): lower = precise color match, higher = broader. Uniform bg → 25-45, complex bg → 55-85
- edgeTolerance (10–250): lower = stops at sharp edges (30-60), higher = soft/hair edges (80-150)
- "remove background" → seeds on background areas (NOT the subject)
- "remove [object]" → seeds on that specific object

ADJUST RULES:
- brightness: -100 to 100 (negative = darker, positive = brighter)
- contrast: -100 to 100 (negative = flatter, positive = more contrast)
- saturation: -100 to 100 (negative = desaturate/grayscale, positive = vibrant)
- sharpen: true/false

INTENT SELECTION EXAMPLES:
- "remove the background" → remove_pixels
- "delete the black shirt" → remove_pixels
- "remove everything except the person" → remove_pixels
- "fix the lighting" → adjust (brightness +15, contrast +20)
- "make it look more professional" → adjust (contrast +15, saturation -5, sharpen true)
- "enhance the image" → adjust (brightness +5, contrast +20, saturation +10, sharpen true)
- "make the colors pop" → adjust (saturation +30, contrast +15)
- "make it black and white" → adjust (saturation -100)
- "sharpen the image" → adjust (sharpen true, contrast +10)
- "brighten it up" → adjust (brightness +30, contrast +10)
- "describe this image" → describe

plan should have 2–4 clear human-readable steps explaining exactly what will happen.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 900,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" },
            },
            {
              type: "text",
              text: `Image dimensions: ${width}×${height}px.\n\nUser request: "${prompt}"\n\nAnalyze the image thoroughly and return the JSON command.`,
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    type ParsedAction =
      | { type: "remove_pixels"; seedPoints?: { x: number; y: number }[]; tolerance?: number; edgeTolerance?: number }
      | { type: "adjust"; brightness?: number; contrast?: number; saturation?: number; sharpen?: boolean }
      | { type: "describe" };

    let parsed: {
      message?: string;
      intent?: string;
      plan?: string[];
      action?: ParsedAction;
      hint?: string | null;
    } = {};

    try {
      parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      parsed = {
        message: "I analyzed your image. Could you rephrase your request with more detail?",
        intent: "describe",
        plan: ["Understanding request", "Analyzing image"],
        action: { type: "describe" },
        hint: null,
      };
    }

    const action = parsed.action ?? { type: "describe" };

    let normalizedAction: Record<string, unknown> = { type: "describe" };
    if (action.type === "remove_pixels") {
      const a = action as { type: "remove_pixels"; seedPoints?: { x: number; y: number }[]; tolerance?: number; edgeTolerance?: number };
      normalizedAction = {
        type: "remove_pixels",
        seedPoints: (a.seedPoints ?? []).map((p) => ({
          x: Math.max(0, Math.min(1, p.x)),
          y: Math.max(0, Math.min(1, p.y)),
        })),
        tolerance:     Math.max(5,  Math.min(120, a.tolerance     ?? 40)),
        edgeTolerance: Math.max(10, Math.min(250, a.edgeTolerance ?? 60)),
      };
    } else if (action.type === "adjust") {
      const a = action as { type: "adjust"; brightness?: number; contrast?: number; saturation?: number; sharpen?: boolean };
      normalizedAction = {
        type: "adjust",
        brightness:  Math.max(-100, Math.min(100, a.brightness  ?? 0)),
        contrast:    Math.max(-100, Math.min(100, a.contrast    ?? 0)),
        saturation:  Math.max(-100, Math.min(100, a.saturation  ?? 0)),
        sharpen: a.sharpen ?? false,
      };
    }

    res.json({
      message:  parsed.message ?? "Analysis complete.",
      intent:   parsed.intent  ?? "describe",
      plan:     Array.isArray(parsed.plan) ? parsed.plan.slice(0, 5) : ["Analyzing image", "Applying changes"],
      action:   normalizedAction,
      hint:     parsed.hint ?? null,
    });
  } catch (err) {
    console.error("AI command error:", err);
    res.status(500).json({ error: "AI analysis failed. Please try again." });
  }
});

export default router;
