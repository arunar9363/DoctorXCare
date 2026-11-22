# DoctorXCare - AI-Powered Digital Health Platform

![DoctorXCare Logo](public/assets/MAINLOGO1.png)

DoctorXCare provides a symptom checker, a disease library, WHO updates, AI chat, report analysis, health tracking, and a nearby facility finder. Private user records are stored in Firebase under the signed-in user?s account.

> DoctorXCare provides educational health information and tools for organizing health records. Clinical decisions belong with a qualified healthcare professional.

## Run locally

Use Node.js 22.12 or newer within the 22.x release and Python 3.12. Copy the root .env.example to .env.local. Set the server keys for the services you want to exercise.

```sh
npm ci
python -m venv .venv
```

On Windows, install and start the Python API with the virtual environment?s interpreter.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn doctorx_backend.main:app --host 127.0.0.1 --port 8000
```

On macOS or Linux, use .venv/bin/python in both commands. If the virtual environment is active, npm run dev:api starts the Python API.

In a second terminal, start the frontend.

```sh
npm run dev
```

Vite serves the Node API handlers and forwards medical reports, tracking, and facility searches to FastAPI. Open the local URL printed by Vite.

## Configure services

| Service | Configuration |
| --- | --- |
| Chat | Set `GROQ_API_KEY`. `GROQ_CHAT_MODEL` optionally selects the chat model. |
| Lab and tracking AI | Set `GOOGLE_API_KEY` or the separate `LAB_SERVICE_API_KEY` and `TRACKING_SERVICE_API_KEY`. |
| Gemini model | Set `GEMINI_MODEL` to override the default. The Python lab and tracking endpoints also support `LAB_GEMINI_MODEL` and `TRACKING_GEMINI_MODEL`. |
| Facility finder | Set `GOOGLE_PLACES_API_KEY` and enable Places API (New) for that key. Set `VITE_Maps_API_KEY` for the optional browser map. |
| Firebase | The existing web configuration is the default. For staging, set all `VITE_FIREBASE_*` settings for the chosen project and apply its Firestore rules. |
| Symptom assessment | Set `GROQ_API_KEY` in the server environment. `GROQ_TRIAGE_MODEL` optionally selects a Groq model that supports strict structured outputs. |
| WHO | The Node API reads WHO news and outbreak reports directly. |

Set server keys in the hosting environment. The Vite-prefixed values are visible in the browser. Keep the Places server key separate from the restricted Maps JavaScript key.

The Groq assessment asks 10 to 15 follow-up questions for routine results. The urgent warning signs screen can show emergency guidance immediately. The report provides a care recommendation, explains what the user reported, and lists possible causes to discuss with a clinician when the answers support them. Users can download the report or save it to History.

Interview answers are held in a signed, one-hour session. Groq receives the intake and answers to generate each question. Saved reports go to the signed-in user's Firestore history when they choose Save to history. Set `TRIAGE_SESSION_SECRET` if you want to rotate the Groq key independently of active interview sessions.

The Firebase emulators can be started with `firebase emulators:start --only auth,firestore --project demo-doctorx`. For local emulator use, set `VITE_FIREBASE_PROJECT_ID=demo-doctorx`, enable the Auth emulator at `127.0.0.1:9099` and the Firestore emulator at `127.0.0.1:8080` in both the corresponding server and Vite settings in .env.local.

## Verify

```sh
npm run lint
npm test
python -m unittest discover -s tests -p "test_*.py" -v
npm run build
```

The tests use synthetic reports and simulated provider responses. The Node and Python readiness endpoints are `/api/health` and `/api/python-health`. They return 503 when required provider configuration is missing.

## Deploy

Vercel uses the Vite project preset and routes the Python APIs through api/medical.py. Keep the repository root as the Vercel project root so both the Node and Python manifests are available.

Apply firestore.rules in the target Firebase project before verifying accounts, bookmarks, readings, and feedback. New feedback uses separate documents for testimonials and private contact details. Legacy feedback remains in its original collection, which the included rules restrict.
