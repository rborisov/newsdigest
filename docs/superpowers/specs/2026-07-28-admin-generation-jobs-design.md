# Admin generation jobs panel — Design

**Date:** 2026-07-28  
**Status:** Approved (option A — job status, not agent stdout)

## Goal

Show recent `GenerationJob` status on `/admin` with light polling so operators can see pending/running/completed/failed without sqlite CLI.

## Design

- Section **Generation jobs** at top of Admin
- Columns: status, trigger, created, updated, digest link or error
- Last 20 jobs via `GET /api/admin/jobs` (admin-gated)
- Poll every 5s while any pending/running; else 30s; manual Refresh
- Out of scope: agent log capture, cancel job, websockets
