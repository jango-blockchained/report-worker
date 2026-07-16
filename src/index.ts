/**
 * report-worker — Automated portfolio performance reports via Browser Rendering.
 *
 * Cron-triggered (06:00 UTC + 18:00 UTC):
 * 1. Fetches portfolio data from D1 (via d1-worker service binding)
 * 2. Renders HTML report page
 * 3. Generates PDF via Cloudflare Browser Rendering REST API
 * 4. Stores PDF in R2 bucket
 * 5. Sends notification link via telegram-worker
 */

import { ScheduledEvent } from "@cloudflare/workers-types";
import {
  createLogger,
  withRequestLog,
  createInternalAuthMiddleware,
} from "@jango-blockchained/hoox-shared/middleware";
import { createRouter } from "@jango-blockchained/hoox-shared/router";
import { healthCheck } from "@jango-blockchained/hoox-shared/health";
import { authenticatedServiceFetch } from "@jango-blockchained/hoox-shared/service-bindings";
import { createCronHandler } from "@jango-blockchained/hoox-shared/cron-handler";

import { createJsonResponse } from "@jango-blockchained/hoox-shared/errors";

// --- Types ---

const logger = createLogger({ service: "report-worker" });

export interface Env extends Cloudflare.Env {
  [key: string]: unknown;
}

interface PortfolioSummary {
  totalValue: number;
  dailyPnL: number;
  totalPnL: number;
  openPositions: number;
  winRate: number;
  topAsset: string;
}

// --- Constants ---

const REPORTS_PREFIX = "reports/";

// --- Router Setup ---

const router = createRouter<Env>();
const requireAuth = createInternalAuthMiddleware();

router.get(
  "/health",
  async (_request: Request, _env: Env, _ctx: ExecutionContext) => {
    return healthCheck({ worker: "report-worker" });
  }
);

router.get(
  "/report",
  async (request: Request, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      generateAndStoreReport(env, ctx).catch((err) =>
        logger.error("generateAndStoreReport failed", { error: String(err) })
      )
    );
    return createJsonResponse(
      { success: true, message: "Report generation started" },
      202
    );
  },
  [requireAuth]
);

// --- Worker Entry ---

const cronHandler = createCronHandler<Env>({
  name: "report-worker",
  logger,
  handler: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      generateAndStoreReport(env, ctx).catch((err) =>
        logger.error("generateAndStoreReport failed", { error: String(err) })
      )
    );
  },
});

export default {
  fetch: withRequestLog(
    (request: Request, env: Env, ctx: ExecutionContext) => {
      return router.handle(request, env, ctx);
    },
    { service: "report-worker", module: "router" }
  ),

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    return await cronHandler(event, env, ctx);
  },
};

async function generateAndStoreReport(
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!env.D1_SERVICE) {
    logger.warn(
      "D1_SERVICE binding not configured — skipping report generation"
    );
    return;
  }

  try {
    const summary = await fetchPortfolioSummary(env);
    const html = buildReportHtml(summary);
    const pdfBuffer = await generatePdf(html, env);
    const key = `${REPORTS_PREFIX}daily-${Date.now()}.pdf`;
    await env.REPORTS_BUCKET.put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    // Notification is fire-and-forget: don't block on it
    ctx.waitUntil(
      sendNotification(env, key, summary).catch((err) =>
        logger.error("sendNotification failed", { error: String(err) })
      )
    );
  } catch (err) {
    logger.error("Failed to generate report", { error: err });
  }
}

// --- Exports for testing ---

export {
  generatePdf,
  sendNotification,
  fetchPortfolioSummary,
  buildReportHtml,
  generateAndStoreReport,
};

// --- Helpers ---

async function fetchPortfolioSummary(env: Env): Promise<PortfolioSummary> {
  if (!env.D1_SERVICE) {
    throw new Error(
      "D1_SERVICE binding not configured — cannot fetch portfolio data"
    );
  }

  try {
    if (!env.INTERNAL_KEY_BINDING) {
      throw new Error(
        "INTERNAL_KEY_BINDING not configured — cannot fetch portfolio data"
      );
    }

    const [balancesRes, positionsRes] = await Promise.all([
      authenticatedServiceFetch(env.D1_SERVICE, env, "/api/balances", undefined, {
        method: "GET",
      }),
      authenticatedServiceFetch(env.D1_SERVICE, env, "/api/positions", undefined, {
        method: "GET",
      }),
    ]);

    if (!balancesRes.ok || !positionsRes.ok) {
      const errorMsg = `D1 service returned non-OK response: balances=${balancesRes.status}, positions=${positionsRes.status}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const [balancesData, positionsData] = await Promise.all([
      balancesRes.json() as Promise<{
        success: boolean;
        totalBalance: number;
        balances: { exchange: string; asset: string; total: number }[];
      }>,
      positionsRes.json() as Promise<{
        success: boolean;
        positions: { symbol: string; side: string; unrealized_pnl: number }[];
      }>,
    ]);

    // Aggregate portfolio summary from D1 data
    const totalValue = balancesData.totalBalance ?? 0;
    const openPositions = positionsData.positions?.length ?? 0;

    // Calculate total PnL from positions
    const totalPnL = (positionsData.positions ?? []).reduce(
      (sum, p) => sum + (p.unrealized_pnl ?? 0),
      0
    );

    // Find top asset by balance
    const topAssetEntry = (balancesData.balances ?? []).sort(
      (a, b) => (b.total ?? 0) - (a.total ?? 0)
    )[0];
    const topAsset = topAssetEntry ? `${topAssetEntry.asset}` : "N/A";

    // Win rate: positions with positive PnL / total positions
    const winningPositions = (positionsData.positions ?? []).filter(
      (p) => (p.unrealized_pnl ?? 0) > 0
    ).length;
    const winRate =
      openPositions > 0
        ? Math.round((winningPositions / openPositions) * 1000) / 10
        : 0;

    return {
      totalValue,
      dailyPnL: totalPnL, // Using total unrealized PnL as daily proxy
      totalPnL,
      openPositions,
      winRate,
      topAsset,
    };
  } catch (err) {
    logger.error("Failed to fetch portfolio summary from D1", { error: err });
    throw err;
  }
}

function buildReportHtml(summary: PortfolioSummary): string {
  const date = new Date().toISOString().split("T")[0];
  const changeClass = summary.dailyPnL >= 0 ? "positive" : "negative";
  const changeSign = summary.dailyPnL >= 0 ? "+" : "";
  const totalChangeClass = summary.totalPnL >= 0 ? "positive" : "negative";
  const totalChangeSign = summary.totalPnL >= 0 ? "+" : "";

  // C-7 (2026-06-27 worker audit): every string interpolated into
  // the HTML must be HTML-escaped, otherwise an attacker who can
  // influence the value (D1 data, signal text, balance.asset) can
  // inject arbitrary HTML/script that gets embedded in the rendered
  // PDF and runs when opened in a browser-based PDF viewer.
  const safeTopAsset = escapeHtml(summary.topAsset);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 2rem; color: #1a1a2e; }
  h1 { color: #16213e; border-bottom: 3px solid #0f3460; padding-bottom: 0.5rem; }
  .date { color: #666; font-size: 0.9em; margin-top: -0.5rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 2rem 0; }
  .card { background: #f8f9fa; border-radius: 8px; padding: 1rem; border: 1px solid #e9ecef; }
  .card h2 { margin: 0 0 0.3rem; font-size: 0.85em; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 1.5em; font-weight: 700; margin: 0; }
  .positive { color: #16a34a; }
  .negative { color: #dc2626; }
  .footer { margin-top: 2rem; font-size: 0.8em; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 1rem; }
</style>
</head>
<body>
<h1>Hoox Portfolio Report</h1>
<p class="date">${date}</p>
<div class="grid">
  <div class="card">
    <h2>Total Value</h2>
    <p class="value">$${summary.totalValue.toLocaleString()}</p>
  </div>
  <div class="card">
    <h2>Daily P&L</h2>
    <p class="value ${changeClass}">${changeSign}$${summary.dailyPnL.toLocaleString()}</p>
  </div>
  <div class="card">
    <h2>Total P&L</h2>
    <p class="value ${totalChangeClass}">${totalChangeSign}$${summary.totalPnL.toLocaleString()}</p>
  </div>
  <div class="card">
    <h2>Open Positions</h2>
    <p class="value">${summary.openPositions}</p>
  </div>
  <div class="card">
    <h2>Win Rate</h2>
    <p class="value">${summary.winRate}%</p>
  </div>
  <div class="card">
    <h2>Top Asset</h2>
    <p class="value">${safeTopAsset}</p>
  </div>
</div>
<p style="margin-top: 1rem; color: #444;">Generated by Hoox — Automated Trading System</p>
<div class="footer">
  <p>This report was automatically generated. Past performance does not guarantee future results.</p>
</div>
</body>
</html>`;
}

/**
 * Escape a string for safe interpolation into HTML text content
 * and quoted attribute values. Defends against C-7 (XSS in the
 * generated PDF) and any future code that interpolates a string
 * value into the report HTML.
 *
 * Escapes the five characters that have special meaning in HTML
 * text and attribute contexts: &, <, >, ", '
 */
function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generate a PDF from HTML using the Cloudflare Browser Rendering binding.
 *
 * Uses the native `browser` Worker binding (configured in wrangler.jsonc under
 * the `browser` key with binding name "BROWSER"). The `quickAction("pdf", ...)`
 * method sends HTML content to the Browser Rendering service and returns a PDF
 * buffer — this is the supported approach for Cloudflare Workers. No separate
 * REST API call or API token is needed when using this binding.
 */
async function generatePdf(html: string, env: Env): Promise<ArrayBuffer> {
  if (!env.BROWSER) {
    logger.error("Browser Rendering binding not configured", {
      binding: "BROWSER",
    });
    throw new Error(
      "BROWSER (Browser Rendering) binding not configured — PDF generation unavailable"
    );
  }

  const browser = env.BROWSER as {
    quickAction: (
      action: string,
      params: Record<string, unknown>
    ) => Promise<Response>;
  };

  try {
    const pdfPromise = browser.quickAction("pdf", {
      html,
      options: {
        format: "A4",
        printBackground: true,
        margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
      },
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("PDF generation timed out after 60s")),
        60000
      )
    );
    const response = await Promise.race([pdfPromise, timeoutPromise]);

    if (!response.ok) {
      const text = await response.text();
      logger.error("Browser Rendering PDF generation returned error", {
        status: response.status,
        errorBody: text?.slice(0, 500),
        htmlLength: html.length,
      });
      throw new Error(
        `Browser Rendering PDF error: ${response.status} — ${text}`
      );
    }

    return response.arrayBuffer() as Promise<ArrayBuffer>;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("Browser Rendering PDF error")
    ) {
      throw err; // Already logged above with full context
    }
    logger.error("Browser Rendering PDF generation threw exception", {
      error: err instanceof Error ? err.message : String(err),
      htmlLength: html.length,
    });
    throw err;
  }
}

async function sendNotification(
  env: Env,
  key: string,
  summary: PortfolioSummary
): Promise<void> {
  if (!env.TELEGRAM_SERVICE) return;
  if (!env.REPORT_WORKER_URL) {
    logger.warn("REPORT_WORKER_URL not configured — skipping notification");
    return;
  }

  const signedUrl = `https://${env.REPORT_WORKER_URL}/${key}`;
  const message = [
    `📊 *Daily Portfolio Report*`,
    ``,
    `Total Value: $${summary.totalValue.toLocaleString()}`,
    `Daily P&L: ${summary.dailyPnL >= 0 ? "+" : ""}$${summary.dailyPnL.toLocaleString()}`,
    `Win Rate: ${summary.winRate}%`,
    ``,
    `[View Report](${signedUrl})`,
  ].join("\n");

  // Construct the payload expected by telegram-worker's /process endpoint
  const payload = {
    payload: { message, chatId: undefined },
  };

  await authenticatedServiceFetch(env.TELEGRAM_SERVICE, env, "/alert", payload);
}
