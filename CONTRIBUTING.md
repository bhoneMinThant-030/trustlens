# Working together

## Branches

- One branch per task, with a short descriptive name: `feat/trustlens-panel`, `fix/review-queue`
- Keep branches short-lived: merge within 1–2 days
- Before you start work each day: `git pull origin main` into your branch

## Pull requests

- `main` is protected: every change goes through a PR with 1 approval
- One task per PR, with a clear title, e.g. `TrustLens panel: show claim labels`
- `main` must always run. If a merge breaks it, fix or revert the same day

## Who edits what

- Work in your own folder freely (see the table in `README.md`)
- Changes to someone else's files go through a PR they review
- `docs/api-contract.md`: post in the group chat before changing it
- Database schema: Backend 1 only; others request changes by PR
- New npm or pip packages: announce first, to avoid lockfile conflicts

## Before you commit

- Code is formatted (Prettier for JS, Black for Python)
- No secrets, no `node_modules`, no database files
