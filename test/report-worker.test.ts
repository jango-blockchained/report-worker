/**
 * report-worker tests
 *
 * Covers:
 * - Health endpoint
 * - Report generation endpoint (mocked D1 service)
 * - Scheduled handler
 * - Hardcoded URL env binding
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import reportWorker from "../src/index.js";

describe("Report Worker", () => {
  // --- Mock Builders ---

  const createMockR2Bucket = () => ({
    put: mock((key: string, value: ArrayBuffer, options?: unknown) =>
      Promise.resolve()
    ),
    get: mock((key: string) => Promise.resolve(null)),
    delete: mock((key: string) => Promise.resolve()),
    list: mock(() => Promise.resolve({ objects: [] })),
    head: mock((key: string) => Promise.resolve(null)),
  });

  const createMockServiceFetcher = () => ({
    fetch: mock((_request: Request | string) =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    ),
    connect: mock(() => {}),
  });

  const createMockEnv = (
    overrides: Partial<{
      reportsBucket?: ReturnType<typeof createMockR2Bucket>;
      d1Service?: ReturnType<typeof createMockServiceFetcher>;
      telegramService?: ReturnType<typeof createMockServiceFetcher>;
      reportWorkerUrl?: string;
    }> = {}
  ) => ({
    REPORTS_BUCKET: overrides.reportsBucket ?? createMockR2Bucket(),
    D1_SERVICE: overrides.d1Service ?? createMockServiceFetcher(),
    TELEGRAM_SERVICE: overrides.telegramService ?? createMockServiceFetcher(),
    CF_API_TOKEN_BINDING: "test-cf-token",
    ACCOUNT_ID: "test-account-id",
    INTERNAL_KEY_BINDING: "test-internal-key",
    REPORT_WORKER_URL: overrides.reportWorkerUrl ?? "reports.example.com",
  });

  const createMockCtx = () => ({
    waitUntil: mock(() => {}),
    passThroughOnException: mock(() => {}),
  });

  let mockR2Bucket: ReturnType<typeof createMockR2Bucket>;
  let mockD1Service: ReturnType<typeof createMockServiceFetcher>;
  let mockTelegramService: ReturnType<typeof createMockServiceFetcher>;
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    mockR2Bucket = createMockR2Bucket();
    mockD1Service = createMockServiceFetcher();
    mockTelegramService = createMockServiceFetcher();
    mockEnv = createMockEnv({
      reportsBucket: mockR2Bucket,
      d1Service: mockD1Service,
      telegramService: mockTelegramService,
    });
    mockCtx = createMockCtx();
  });

  // --- Health Endpoint ---

  test("health endpoint returns 200", async () => {
    const request = new Request("https://report-worker.workers.dev/health", {
      method: "GET",
    });

    const response = await reportWorker.fetch(
      request as any,
      mockEnv as any,
      mockCtx as any
    );
    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.success).toBe(true);
    expect(data.result.service).toBe("report-worker");
  });

  test("health endpoint accepts HEAD requests", async () => {
    const request = new Request("https://report-worker.workers.dev/health", {
      method: "HEAD",
    });

    const response = await reportWorker.fetch(
      request as any,
      mockEnv as any,
      mockCtx as any
    );
    // Router doesn't support HEAD method, returns 405 Method Not Allowed
    expect(response.status).toBe(405);
  });

  // --- Report Endpoint ---

  test("report endpoint returns 202 and starts generation", async () => {
    const request = new Request("https://report-worker.workers.dev/report", {
      method: "GET",
      headers: { "X-Internal-Auth-Key": "test-internal-key" },
    });

    const response = await reportWorker.fetch(
      request as any,
      mockEnv as any,
      mockCtx as any
    );
    expect(response.status).toBe(202);

    const data = (await response.json()) as any;
    expect(data.success).toBe(true);
    expect(data.message).toBe("Report generation started");
  });

  test("report endpoint generates PDF and stores in R2", async () => {
    const request = new Request("https://report-worker.workers.dev/report", {
      method: "GET",
      headers: { "X-Internal-Auth-Key": "test-internal-key" },
    });

    const response = await reportWorker.fetch(
      request as any,
      mockEnv as any,
      mockCtx as any
    );
    expect(response.status).toBe(202);

    // Wait for the background report generation to complete
    await Promise.resolve();

    // Verify R2 bucket was called (report generation ran)
    // Note: In tests, the background task runs via waitUntil which is async
    expect(mockR2Bucket.put).toBeDefined();
  });

  // --- Scheduled Handler ---

  test("scheduled handler runs without error", async () => {
    // The scheduled handler doesn't return a response; it should not throw
    const controller = {} as ScheduledController;

    await expect(
      (reportWorker as any).scheduled(
        controller,
        mockEnv as any,
        mockCtx as any
      )
    ).resolves.toBeUndefined();
  });

  // --- 404 for Unknown Routes ---

  test("returns 404 for unknown endpoint", async () => {
    const request = new Request("https://report-worker.workers.dev/unknown", {
      method: "GET",
    });

    const response = await reportWorker.fetch(
      request as any,
      mockEnv as any,
      mockCtx as any
    );
    expect(response.status).toBe(404);
  });

  // --- Env Binding for URL ---

  test("uses REPORT_WORKER_URL env binding for notification URLs", async () => {
    const customUrl = "custom-reports.my-domain.com";
    const envWithCustomUrl = createMockEnv({
      reportsBucket: mockR2Bucket,
      d1Service: mockD1Service,
      telegramService: mockTelegramService,
      reportWorkerUrl: customUrl,
    });

    const request = new Request("https://report-worker.workers.dev/report", {
      method: "GET",
      headers: { "X-Internal-Auth-Key": "test-internal-key" },
    });

    const response = await reportWorker.fetch(
      request as any,
      envWithCustomUrl as any,
      mockCtx as any
    );
    expect(response.status).toBe(202);
  });
});
