const MAX_INPUT_CHARS = 6_000_000;

const STYLES = {
  modern: "modern minimalist interior, restrained neutral palette, refined architectural detailing",
  cream: "warm creamy interior, beige tones, soft matte finishes, elegant diffused light",
  wabisabi: "wabi-sabi interior, micro-cement, natural wood, quiet earthy materiality",
  nordic: "Scandinavian interior, pale oak, bright natural light, functional simplicity",
  japandi: "Japandi interior, Japanese restraint blended with Scandinavian warmth",
  luxury: "understated modern luxury, refined stone, brushed metal accents, sophisticated soft light",
  zen: "East Asian Zen atmosphere, balanced calm material palette, natural wood"
};

function buildPrompt(body) {
  const mode = body.mode === "style" ? "STYLE TRANSFER" : "PURE PHOTOREALISM";
  const style = STYLES[body.style] || STYLES.modern;
  const extra = String(body.userPrompt || "").slice(0, 1200);
  return `[ROLE: SENIOR ARCHITECTURAL PHOTOGRAPHY + PBR FINISHING ENGINE]

MODE: ${mode}

The supplied image is the authoritative geometry and camera plate. Produce a finished, high-end architectural photograph, NOT a redesign.

HIGHEST PRIORITY — GEOMETRY / CAMERA LOCK:
- Preserve the exact crop, aspect ratio, camera position, perspective, vanishing points, room dimensions, ceiling heights, walls, beams, doors, windows, cabinets, built-ins, furniture silhouettes, object count, panel lines, joints, gaps, reveals and trim.
- DO NOT add, remove, move, resize, bend, duplicate, replace or reinterpret any architectural element or furniture.
- Straight construction lines must remain straight. Existing verticals and perspective must remain coherent.
- When realism conflicts with geometry preservation, geometry preservation wins.

PHOTOREALISTIC PBR STANDARD:
- Convert flat CGI surfaces into physically plausible materials with correct texture scale, micro-roughness, restrained bump/normal detail, contact shadows and natural reflection behavior.
- Wood grain must follow construction direction and avoid repeated tiling.
- Stone/concrete needs subtle aggregate and roughness variation without plastic gloss.
- Fabric needs fine fiber response and soft grazing highlights.
- Metal uses physically correct metallic reflection; no chrome unless clearly present.
- Glass needs Fresnel reflection, believable transparency/refraction and subtle thickness.
- Use realistic GI, bounced light, ambient occlusion, soft penumbra, natural exposure roll-off, highlight recovery and shadow detail.
- Avoid fake HDR, oversharpening, waxy denoising, excessive bloom, halos, game-engine glow, orange cast, cyan shadows and oversaturated wood.

ANTI-HALLUCINATION:
- No new decorations, people, plants, lamps, switches, outlets, art, molding, hardware, seams, text, logos or props unless already visible.
- Do not change the exterior view unless necessary to preserve what is already visible.
- No AI artifacts, warped cabinetry, melted furniture, duplicated objects or impossible reflections.

LIGHTING DIRECTION:
${String(body.lighting || "Natural realistic daylight").slice(0,300)}

${body.mode === "style" ? `STYLE MATERIAL DIRECTION:
Apply ${style} only through surface finish, color/material character and lighting atmosphere. Do not add style-signature objects.` : "MATERIAL DIRECTION: Preserve the existing design language and material identity; improve realism only."}

USER FINE-TUNE:
${extra || "Increase realism, keep materials refined and camera exposure balanced."}

OUTPUT:
Return ONE clean architectural render only. Structural fidelity first, realism second, stylistic polish third.`;
}

function findImage(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  for (const step of steps) {
    const content = Array.isArray(step?.content) ? step.content : [];
    for (const part of content) {
      if (part?.type === "image" && part?.data) return { data: part.data, mime: part.mime_type || "image/jpeg" };
    }
  }
  if (result?.output_image?.data) return { data: result.output_image.data, mime: result.output_image.mime_type || "image/jpeg" };
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "伺服器尚未設定 GEMINI_API_KEY。" });

  try {
    const body = req.body || {};
    const image = String(body.image || "");
    if (!image.startsWith("data:image/") || image.length > MAX_INPUT_CHARS) {
      return res.status(400).json({ error: "圖片格式錯誤或檔案過大，請換較小的 JPG/PNG。" });
    }
    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) return res.status(400).json({ error: "不支援的圖片格式。" });

    const quality = body.quality === "4K" ? "4K" : "2K";
    const model = quality === "4K" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
    const prompt = buildPrompt(body);
    const payload = {
      model,
      input: [
        { type: "image", mime_type: match[1], data: match[2] },
        { type: "text", text: prompt }
      ],
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        image_size: quality
      }
    };

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      if (response.ok) {
        const result = JSON.parse(text);
        const output = findImage(result);
        if (!output) return res.status(502).json({ error: "Gemini 已完成但沒有回傳圖片。" });
        return res.status(200).json({ image: `data:${output.mime};base64,${output.data}`, model, quality });
      }
      lastError = text.slice(0, 1200);
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) break;
      await new Promise(r => setTimeout(r, 1200 * Math.pow(2, attempt)));
    }
    return res.status(502).json({ error: "Gemini 目前無法完成渲染，請稍後再試。", detail: lastError });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "伺服器渲染流程發生錯誤。" });
  }
};