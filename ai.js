/* ==========================================================================
   ai.js — AI features for Stash (Gemini API key from Google AI Studio)

   extractTasks(note) resolves to { title: string, items: string[] };
   app.js turns that into a new To-Do card.

   SETUP: get a key at https://aistudio.google.com/apikey and paste it below.

   NOTE: a key in browser code can be seen by anyone who opens your app.
   Keep your GitHub repo PRIVATE, don't share the app link widely, and
   (optional) restrict the key to your website in Google Cloud Console →
   APIs & Services → Credentials → your key → Website restrictions.

   Until a key is pasted, a simple offline splitter is used instead.
   ========================================================================== */

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_ITEMS = 8;

const hasKey = () => !GEMINI_API_KEY.startsWith("YOUR_");

/* ---------- Gemini ---------- */
async function extractWithGemini(note) {
  const prompt =
    `Turn this note into a short, actionable to-do list.\n` +
    `Return a concise title and 2 to ${MAX_ITEMS} tasks. Each task should be a short imperative phrase. ` +
    `Write in the same language as the note. Don't invent tasks that aren't implied by the note.\n\n` +
    `Note title: ${note.title || "(none)"}\n\nNote text:\n${note.text}`;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            items: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["title", "items"],
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (${res.status}) ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const parsed = JSON.parse(data.candidates[0].content.parts[0].text);

  const items = (parsed.items || [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  if (!items.length) throw new Error("No tasks found in this note.");

  return {
    title: String(parsed.title || "").trim() || `Tasks: ${note.title || "Untitled note"}`,
    items,
  };
}

/* ---------- Offline fallback (no key yet) ---------- */
async function extractOffline(note) {
  await new Promise((r) => setTimeout(r, 800));
  const items = (note.text || "")
    .split(/[\n.;!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .slice(0, MAX_ITEMS);
  if (!items.length) throw new Error("No tasks found in this note.");
  return { title: `Tasks: ${note.title?.trim() || "Untitled note"}`, items };
}

/* ---------- Public API ---------- */
export async function extractTasks(note) {
  if (!hasKey()) return extractOffline(note);
  try {
    return await extractWithGemini(note);
  } catch (err) {
    console.error("Gemini task extraction failed:", err);
    if (err.message === "No tasks found in this note.") throw err;
    throw new Error("AI failed. Check your Gemini key in ai.js.");
  }
}
