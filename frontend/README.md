# Frontend (React)

Owners: Frontend 1 (officer screen), Frontend 2 (back office)

## Set up (Frontend 1, once)

```bash
cd frontend
npm create vite@latest . -- --template react
npm install
npm run dev
```

## Plan

- Routes: `/officer` (mock inbox + TrustLens panel) and `/backoffice` (Review queue, Dashboard, Recommendations, Approved answers)
- One shared API client in `src/api/` built from `docs/api-contract.md`
- Use mock JSON until the Node endpoints are ready
- Mock emails: `data/emails/`

## Development

The frontend uses React with Vite.

### Run locally

```bash
cd frontend
npm install
npm run dev
```

Open the local URL shown in the terminal (usually http://localhost:5173/).

### Current progress

- React + Vite project initialised.
- ESLint configured.
- Officer Workspace: Not started.
- Back Office: Not started.
- Backend API integration: Not started.