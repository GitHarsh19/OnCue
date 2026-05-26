# OnCue — Web App Build Prompt

Use this prompt to build the OnCue web application. Paste it into any capable coding AI (Claude, GPT-4, etc.) or use it as your engineering spec.

---

## MASTER PROMPT

Build a full-stack web application called **OnCue** — a live salon queue intelligence platform. The app uses the device's inbuilt camera combined with an open-source vision-language model via the **Groq API** to detect and count people in different zones of a salon (waiting sofa, service chairs, entry) and display a live queue to both salon owners and customers.

---

## TECH STACK

- **Frontend**: React (Vite) + TailwindCSS
- **Backend**: Node.js with Express
- **AI Model**: Use Groq API with `meta-llama/llama-4-scout-17b-16e-instruct` (vision-capable) for camera frame analysis
- **Real-time**: WebSockets (ws library) for live queue updates pushed to all connected clients
- **Database**: In-memory store for V1 (no database setup needed) — plain JavaScript object on the server
- **Camera**: Browser native `getUserMedia` API — no libraries needed

---

## GROQ API USAGE

```javascript
// Install: npm install groq-sdk

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Send a base64 camera frame to the vision model
const response = await groq.chat.completions.create({
  model: "meta-llama/llama-4-scout-17b-16e-instruct",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${base64Frame}`,
          },
        },
        {
          type: "text",
          text: `You are a salon queue monitoring system. Analyze this camera image of a salon.

Count the number of people in each zone:
- WAITING ZONE: People sitting on sofas or chairs in the waiting area (customers waiting for service)
- SERVICE ZONE: People sitting in barber/styling chairs actively getting a haircut or treatment
- ENTRY ZONE: People standing near the entrance or moving through

Important rules:
- Only count people who appear to be stationary (seated or standing still)
- Do not count people who appear to be staff (wearing aprons or uniforms if visible)
- If a zone is not clearly visible, return -1 for that zone

Respond ONLY with valid JSON in this exact format, no explanation:
{
  "waiting": <number>,
  "service": <number>, 
  "entry": <number>,
  "confidence": <"high" | "medium" | "low">,
  "notes": "<brief observation if anything unusual>"
}`,
        },
      ],
    },
  ],
  max_tokens: 200,
});

const result = JSON.parse(response.choices[0].message.content);
```

---

## APPLICATION STRUCTURE

```
oncue/
├── client/                    # React frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── OwnerDashboard.jsx   # Salon owner view — camera + controls
│   │   │   ├── LiveDisplay.jsx      # Customer-facing live queue display
│   │   │   └── PublicView.jsx       # Public read-only salon page
│   │   ├── components/
│   │   │   ├── CameraFeed.jsx       # Camera capture + frame extraction
│   │   │   ├── QueueBoard.jsx       # Live token/queue display
│   │   │   ├── ZoneCounter.jsx      # Shows count per zone
│   │   │   ├── WaitTimeBadge.jsx    # Estimated wait time display
│   │   │   └── StatusIndicator.jsx  # System health / camera status
│   │   └── hooks/
│   │       ├── useCamera.js         # Camera stream management
│   │       ├── useWebSocket.js      # WebSocket connection + reconnect
│   │       └── useQueueState.js     # Local queue state management
├── server/
│   ├── index.js               # Express + WebSocket server
│   ├── routes/
│   │   ├── queue.js           # Queue CRUD endpoints
│   │   └── analyze.js         # Frame analysis endpoint (calls Groq)
│   └── store/
│       └── queueStore.js      # In-memory salon queue state
├── .env                       # GROQ_API_KEY=your_key_here
└── package.json
```

---

## CORE FEATURES TO BUILD

### Feature 1 — Camera Capture & Analysis

**File: `client/src/components/CameraFeed.jsx`**

- Access device camera using `navigator.mediaDevices.getUserMedia({ video: true })`
- Render live camera feed in a `<video>` element
- Every **15 seconds**, capture a frame by drawing the video to a hidden `<canvas>` element
- Convert canvas to base64 JPEG: `canvas.toDataURL('image/jpeg', 0.7)`
- Send base64 frame to backend `/api/analyze` endpoint
- Show a pulsing indicator when a frame analysis is in progress
- Show last analysis timestamp
- Allow manual "Analyze Now" button to trigger analysis immediately
- Handle camera permission denied gracefully — show a clear error state with instructions

**Motion detection optimization (important):**
Before sending to Groq, compare the current frame to the previous frame using pixel difference on the canvas. Only send to Groq if the pixel difference exceeds a threshold (meaning something actually changed in the scene). This prevents unnecessary API calls when the salon is static.

```javascript
// Simple pixel diff on canvas
function hasSignificantMotion(prevImageData, currImageData, threshold = 15) {
  let diffCount = 0;
  for (let i = 0; i < currImageData.data.length; i += 4) {
    const diff = Math.abs(currImageData.data[i] - prevImageData.data[i]);
    if (diff > threshold) diffCount++;
  }
  const percentChanged = (diffCount / (currImageData.data.length / 4)) * 100;
  return percentChanged > 2; // More than 2% pixels changed = motion
}
```

---

### Feature 2 — Backend Queue State Engine

**File: `server/store/queueStore.js`**

Manage an in-memory store for each salon:

```javascript
const store = {
  salonId: {
    waiting: 0,          // People in waiting zone
    inService: 0,        // People being served
    totalServedToday: 0, // Running count of completed customers
    estimatedWaitMins: 0,// Calculated wait time
    lastUpdated: null,   // Timestamp of last camera update
    cameraOnline: false, // Is the owner dashboard connected
    history: [],         // Last 20 count snapshots for trend
    stylists: 2,         // Number of active stylists (configurable)
    avgServiceMins: 20,  // Average minutes per service (configurable)
  }
};
```

**Wait time calculation:**

```javascript
function calculateWaitTime(waiting, inService, stylists, avgServiceMins) {
  const availableSlots = Math.max(0, stylists - inService);
  if (availableSlots > 0 && waiting <= availableSlots) return 0;
  const queueAhead = Math.max(0, waiting - availableSlots);
  const roundsNeeded = Math.ceil((waiting) / stylists);
  return roundsNeeded * avgServiceMins;
}
```

---

### Feature 3 — Backend API Endpoints

**`POST /api/analyze`**
- Receives `{ salonId, frameBase64 }` from the owner dashboard camera
- Calls Groq API with the frame and the vision prompt (see above)
- Parses the JSON response from Groq
- Updates the queue store with new counts
- Broadcasts updated queue state to all WebSocket clients connected to this salonId
- Returns `{ success: true, counts: { waiting, service, entry }, waitTime: N }`

**`GET /api/queue/:salonId`**
- Returns current queue state for a salon
- Used by the public view page on initial load

**`POST /api/queue/:salonId/settings`**
- Update salon settings: number of stylists, average service duration
- Body: `{ stylists: 2, avgServiceMins: 20 }`

**`POST /api/queue/:salonId/manual`**
- Manual override — owner can manually adjust counts
- Body: `{ waiting: N, inService: M }`
- Useful for when camera is offline

**`POST /api/queue/:salonId/customer-done`**
- Triggered when a customer finishes and pays
- Decrements inService count by 1, increments totalServedToday
- Broadcasts updated state

---

### Feature 4 — WebSocket Real-time Updates

**Server side:**
- On WebSocket connection, client sends `{ type: "subscribe", salonId: "salon_123" }`
- Server adds client to a room for that salonId
- Whenever queue state changes, broadcast to all subscribers:

```javascript
ws.send(JSON.stringify({
  type: "queue_update",
  salonId: "salon_123",
  data: {
    waiting: 3,
    inService: 2,
    estimatedWaitMins: 20,
    totalServedToday: 14,
    lastUpdated: "2026-04-27T10:30:00Z",
    cameraOnline: true
  }
}));
```

**Client side (useWebSocket.js hook):**
- Auto-reconnect with exponential backoff if connection drops
- Show connection status indicator (green dot = live, red dot = reconnecting)

---

### Feature 5 — Owner Dashboard Page

**File: `client/src/pages/OwnerDashboard.jsx`**

This is the page the salon owner opens on their device (phone or tablet).

Layout:
```
┌─────────────────────────────────────┐
│  OnCue  •  [Salon Name]        │
│  Camera: ● LIVE    AI: analyzing... │
├──────────────────┬──────────────────┤
│                  │  WAITING   [ 3 ] │
│   CAMERA FEED    │  IN CHAIR  [ 2 ] │
│   (live video)   │  WAIT TIME [20m] │
│                  │  SERVED    [ 14] │
├──────────────────┴──────────────────┤
│  [Analyze Now]  [Customer Done +1]  │
│  [Manual Override]  [Settings]      │
└─────────────────────────────────────┘
```

Controls:
- **Analyze Now**: Immediately capture and send frame to Groq
- **Customer Done**: Manually mark one customer as finished (payment received)
- **Manual Override**: Slider/input to manually set waiting count if camera is wrong
- **Settings**: Set number of stylists, average service time per customer
- Show last 5 analysis results in a small history log

---

### Feature 6 — Live Customer Display Page

**File: `client/src/pages/LiveDisplay.jsx`**

This is shown on a TV or screen inside/outside the salon. It auto-updates via WebSocket. Design it to be readable from 3–4 meters away.

Layout:
```
┌─────────────────────────────────────┐
│           💈 QUEUESIGHT             │
│         Sharma's Barbershop         │
├─────────────────────────────────────┤
│                                     │
│    WAITING NOW                      │
│         3                           │
│    ─────────────────────            │
│    ESTIMATED WAIT                   │
│         ~20 minutes                 │
│                                     │
│    Customers served today: 14       │
├─────────────────────────────────────┤
│    ● LIVE    Last updated: just now │
└─────────────────────────────────────┘
```

- Large, readable fonts
- Auto-refreshes via WebSocket — no page reload needed
- Animate count changes (number smoothly counts up/down)
- Show a "CAMERA OFFLINE" state if owner dashboard disconnects
- Green indicator when live, yellow when data is stale (> 10 mins old)

---

### Feature 7 — Public Salon Page

**File: `client/src/pages/PublicView.jsx`**

This is the shareable URL customers open on their phones before going to the salon. Route: `/salon/:salonId`

- Shows same info as Live Display but mobile-optimized
- Smaller, card-style layout
- Share button to copy/share the URL
- "Get directions" button (links to Google Maps with salon address)
- Shows operating status: Open / Closed based on time (configurable hours)
- WebSocket connected — updates live without refresh

---

## ROUTING

```
/                          → Redirect to /owner (for demo)
/owner                     → Owner Dashboard (camera access)
/display                   → Live Display (TV screen view, fullscreen)
/salon/:salonId            → Public customer view
```

Use React Router v6.

---

## UI DESIGN REQUIREMENTS

Design the app with a **clean, modern, high-contrast aesthetic** inspired by airport departure boards and hospital queue systems — utilitarian but polished.

- **Color palette**: Deep navy (`#0F1B2D`) background, crisp white text, electric teal accent (`#00D4AA`) for live indicators and counts
- **Font**: Use `Syne` for headings (geometric, distinctive), `IBM Plex Mono` for numbers/counts (monospaced, reads like a display board)
- **Numbers**: Large, prominent — the count is the hero of every screen
- **Animations**: 
  - Pulsing green dot for live status
  - Smooth number transition when count changes (count up/down animation)
  - Subtle scan line animation on camera feed to indicate active analysis
- **Status indicators**: Clear visual difference between LIVE (green), STALE (amber), OFFLINE (red)
- Load fonts from Google Fonts CDN

---

## ENVIRONMENT VARIABLES

```bash
# .env file (server)
GROQ_API_KEY=your_groq_api_key_here
PORT=3001

# .env file (client)
VITE_WS_URL=ws://localhost:3001
VITE_API_URL=http://localhost:3001
```

---

## ERROR HANDLING REQUIREMENTS

Handle these failure cases gracefully with clear UI feedback:

1. **Camera permission denied** — Show step-by-step instructions to enable camera in browser settings
2. **Groq API error** — Show "AI analysis unavailable" — fall back to last known count, allow manual override
3. **Groq returns unparseable JSON** — Retry once, then show error, do not crash
4. **WebSocket disconnected** — Show reconnecting spinner, auto-retry every 3s with backoff
5. **No motion detected** — Show "Scene stable, skipping analysis" in owner log — this is normal
6. **Model returns low confidence** — Flag the result with an amber indicator, still update counts

---

## SAMPLE DATA / DEMO MODE

Add a demo mode toggle that simulates a busy salon without needing a real camera:

```javascript
// In demo mode, simulate queue changes every 30 seconds
const demoScenarios = [
  { waiting: 0, inService: 1 },
  { waiting: 2, inService: 2 },
  { waiting: 4, inService: 2 },
  { waiting: 3, inService: 2 }, // one customer done
  { waiting: 1, inService: 2 },
  { waiting: 0, inService: 1 }, // getting quieter
];
```

This lets you demo the product to a salon owner without needing the camera set up.

---

## SETUP INSTRUCTIONS TO INCLUDE IN README

```markdown
## Setup

1. Clone the repo
2. Get a free Groq API key from https://console.groq.com
3. Copy `.env.example` to `.env` and add your GROQ_API_KEY
4. npm install (in both /client and /server)
5. npm run dev (starts both client and server concurrently)
6. Open http://localhost:5173/owner on the device with the camera
7. Open http://localhost:5173/display on the TV/screen
8. Share http://localhost:5173/salon/demo with customers
```

---

## WHAT NOT TO BUILD (Keep V1 Simple)

- No user authentication or login system
- No persistent database — in-memory store is fine for V1
- No payment processing integration
- No multi-salon management (one salon per instance is fine)
- No mobile app — browser camera access is sufficient
- No historical analytics dashboard
- No SMS or WhatsApp notifications

---

## DEFINITION OF DONE

The app is complete when:

- [ ] Camera feed is visible on the Owner Dashboard
- [ ] Clicking "Analyze Now" sends a frame to Groq and displays updated counts within 5 seconds
- [ ] Automatic analysis triggers every 15 seconds when motion is detected
- [ ] Live Display page updates counts in real time without page refresh
- [ ] Public View page loads current queue state and stays live via WebSocket
- [ ] Demo mode simulates a working salon without camera
- [ ] All three error states (camera denied, API error, WebSocket disconnect) show clean UI
- [ ] App works on mobile browser (owner uses their phone as the camera device)
```
