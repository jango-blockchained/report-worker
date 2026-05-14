# @hoox/report-worker

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Runtime](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh) [![Platform](https://img.shields.io/badge/Platform-Cloudflare%C2%AE%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)

Generates PDF portfolio reports via Cloudflare Browser Rendering.

## For CLI Users

Reports arrive automatically — no manual action needed. Reports are generated on a cron schedule and stored in R2.

→ [Monitor Trading Guide](../../docs/guides/monitor-trading.md) · [CLI Reference](../../docs/reference/cli-commands.md)

## For Operators

This worker provides automated PDF report generation. It uses Cloudflare Browser Rendering to render portfolio performance reports from analytics data, stores them in R2, and can optionally trigger notifications via the telegram-worker when new reports are available.

→ [Operator Docs](../../docs/devops/workers/report-worker.md)

## Development

```bash
bun test workers/report-worker
```
