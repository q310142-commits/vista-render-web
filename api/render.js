const MAX_INPUT_CHARS = 5_500_000;

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
${String(body.lighting || "Natural realistic daylight").slice(0, 300)}

${body.mode === "style"
  ? `STYLE MATERIAL DIRECTION:
Apply ${style} only through surface finish, color/material character and lighting atmosphere. Do not add style-signature objects.`
  : "MATERIAL DIRECTION: Preserve the existing design language and material identity; improve realism only."}

USER FINE-TUNE:
${extra || "Increase realism, keep materials refined and camera exposure balanced."}

OUTPUT:
Return ONE clean architectural render only. Structural fidelity first, realism second, stylistic polish third.`;
}

function findGeneratedImage(result) {
  const parts = result?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const img = part.inlineData || part.inline_data;
    if (img?.data) {
      return {
        data: img.data,
        mime: img.mimeType || img.mime_type || "image/png"
      };
    }
  }
  return null;
}

function friendlyGeminiError(status, raw) {
  let msg = "";
  try {
    const parsed = JSON.parse(raw);
    msg = parsed?.error?.message || "";
  } catch {}

  if (status === 400) return "Gemini 請求格式或圖片內容不符合要求。" + (msg ? " " + msg : "");
  if (status === 401 || status === 403) return "Gemini API Key 無效、權限不足，或此金鑰尚未開放圖片模型。" + (msg ? " " + msg : "");
  if (status === 429) return "Gemini API 目前已達使用額度或速率限制，請稍後再試。" + (msg ? " " + msg : "");
  if (status >= 500) return "Gemini 伺服器暫時無法處理，請稍後再試。";
  return msg || "Gemini 目前無法完成渲染。";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(503).json({ error: "伺服器尚未設定 GEMINI_API_KEY。" });
  }

  try {
    const body = req.body || {};
    const image = String(body.image || "");

    if (!image.startsWith("data:image/") || image.length > MAX_INPUT_CHARS) {
      return res.status(400).json({
        error: "圖片格式錯誤或檔案過大，請換較小的 JPG / PNG / WEBP。"
      });
    }

    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "不支援的圖片格式。" });
    }

    const quality = body.quality === "4K" ? "4K" : "2K";
    const model = quality === "4K"
      ? "gemini-3-pro-image"
      : "gemini-3.1-flash-image";

    const prompt = buildPrompt(body);

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: match[1],
                data: match[2]
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: {
            imageSize: quality
          }
        }
      }
    };

    let lastStatus = 500;
    let lastRaw = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      const url =
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify(payload)
      });

      lastStatus = response.status;
      lastRaw = await response.text();

      if (response.ok) {
        let result;
        try {
          result = JSON.parse(lastRaw);
        } catch {
          return res.status(502).json({
            error: "Gemini 回傳格式無法解析，請重新嘗試。"
          });
        }

        const output = findGeneratedImage(result);

        if (!output) {
          const textPart = result?.candidates?.[0]?.content?.parts?.find(
            p => p.text
          )?.text;

          return res.status(502).json({
            error: "Gemini 已完成請求，但沒有回傳圖片。",
            detail: textPart || ""
          });
        }

        return res.status(200).json({
          image: `data:${output.mime};base64,${output.data}`,
          model,
          quality
        });
      }

      if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 1200 * Math.pow(2, attempt))
      );
    }

    return res.status(lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502).json({
      error: friendlyGeminiError(lastStatus, lastRaw),
      upstreamStatus: lastStatus
    });
  } catch (error) {
    console.error("VISTA render error:", error);
    return res.status(500).json({
      error: "伺服器渲染流程發生錯誤，請稍後再試。"
    });
  }
};
