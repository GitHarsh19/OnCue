# OnCue

Live salon queue intelligence. A camera in the salon is analyzed periodically by a vision AI model; counts of waiting / in-service customers are broadcast over WebSocket to public and in-store displays, and an estimated wait time is computed live.

## How it works

1. The owner opens `/owner` and points the rear camera at the salon (or loads a recorded video for testing).
2. Every ~30s a frame is captured. A pixel-diff motion check skips analysis when the scene hasn't changed, to save API calls.
3. The frame is sent to a vision model, which counts people in **waiting / service / entry** zones and returns bounding boxes.
4. Owner-drawn **mirror masks** suppress reflections — any detection inside a masked polygon is dropped server-side.
5. Counts feed a wait-time estimate and are broadcast over WebSocket to the live display and customer phones.

## Setup

1. Get a Gemini API key from https://aistudio.google.com (OpenAI is also supported).
2. Run the installer — it installs all deps and creates `server/.env` from the template:
   ```bash
   ./setup.sh
   ```
3. Edit `server/.env` and add your key:
   ```
   PORT=3001
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemma-4-31b-it   # default; override if desired
   ```
4. Start both server and client:
   ```bash
   npm run dev
   ```
5. Open:
   - `http://localhost:5173/owner` — Owner Dashboard (the camera device)
   - `http://localhost:5173/display` — Live Display (in-store TV)
   - `http://localhost:5173/demo` — Public customer view

## Stack

- **Frontend:** React (Vite) + TailwindCSS + react-router
- **Backend:** Node (ESM) + Express + `ws`
- **AI:** Multi-provider vision — Gemini (default, `gemma-4-31b-it`) or OpenAI, auto-detected from env keys
- **Storage:** in-memory store (no DB; single-process)
- **Realtime:** WebSocket rooms keyed by `salonId`

The AI prompt and provider logic live in `server/routes/analyze.js`. See `CLAUDE.md` for full architecture details.

## Demo mode

Toggle demo mode on the owner dashboard to simulate rotating queue activity without a camera or API key.
