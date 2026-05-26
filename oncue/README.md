# OnCue

Live salon queue intelligence — uses your device camera + Groq vision API to count people in waiting / service / entry zones and broadcast a live queue to displays and customer phones.

## Setup

1. Get a free Groq API key from https://console.groq.com
2. Copy `.env.example` to `server/.env` and set `GROQ_API_KEY`
3. Install deps: `npm run install:all`
4. Run: `npm run dev`
5. Open:
   - `http://localhost:5173/owner` — Owner Dashboard (camera device)
   - `http://localhost:5173/display` — Live Display (TV)
   - `http://localhost:5173/salon/demo` — Public customer view

## Stack
- React (Vite) + Tailwind
- Node/Express + ws
- Groq `meta-llama/llama-4-scout-17b-16e-instruct`
- In-memory store (no DB)

## Demo mode
Toggle on the owner dashboard to simulate queue activity without a camera.
