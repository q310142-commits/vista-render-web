module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "VISTA AI Render",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString()
  });
};