# VISTA AI Render

Internal architectural photorealistic rendering web tool.

## Deploy on Vercel

1. Import this GitHub repository into Vercel.
2. Add an encrypted environment variable named `GEMINI_API_KEY`.
3. Deploy.
4. Open `/api/health` and verify `geminiConfigured: true`.

The Gemini key is used only in the serverless function and is never sent to the browser.

## Render engines

- Stable 2K: `gemini-3.1-flash-image`
- Extreme 4K: `gemini-3-pro-image`

For daily team use, Stable 2K is recommended for speed and reliability.
