# ReadyRoute V2 — Frontend

React + TypeScript + Vite single-page app that talks to the FastAPI backend at
`http://127.0.0.1:8000`.

## Stack
- Vite 5 + React 18 + TypeScript
- React Router 6
- TanStack Query 5
- Tailwind CSS 3
- axios (with JWT auto-attach + 401 logout)

## Develop
```powershell
cd frontend
npm install
npm run dev
```
Then open http://localhost:5173. The Vite dev server proxies `/api/*` to the
FastAPI backend on port 8000, so make sure the backend is running first.

## Build
```powershell
npm run build
npm run preview
```

## Layout
- `src/api/client.ts` — axios instance + JWT interceptor
- `src/api/hooks.ts` — TanStack Query hooks per backend resource
- `src/contexts/AuthContext.tsx` — token + user persistence in `localStorage`
- `src/components/` — `Layout` (sidebar) and `ProtectedRoute`
- `src/pages/` — `Login`, `Dashboard`, `Fleet`, `Batches`, `Shorts`, `Audit`,
  `Communications`, `Settings`
