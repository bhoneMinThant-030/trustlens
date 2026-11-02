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
