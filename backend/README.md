# Backend (Node.js)

Owners: Backend 1 (core API, database, threshold rule), Backend 2 (review workflow, live updates, stats)

## Set up (Backend 1, once)

```bash
cd backend
npm init -y
npm install express socket.io @aws-sdk/client-lambda dotenv
cp .env.example .env    # then fill it in; never commit .env
```

## Plan

- Endpoints and payloads: `docs/api-contract.md`
- `USE_MOCK_LAMBDA=true` returns fixed contract JSON so the frontend is never blocked
- Calls the AI Lambda with `InvokeCommand`, using an IAM user that can only invoke that one function
- Schema changes: Backend 1 only
