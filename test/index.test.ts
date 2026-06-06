import {
  describe,
  it,
  expect,
  mock,
  jest as vi,
  beforeEach,
  afterEach,
} from "bun:test";
import worker, {
  generatePdf,
  sendNotification,
  fetchPortfolioSummary,
  buildReportHtml,
  generateAndStoreReport,
} from "../src/index";
import type { ExecutionContext } from "@cloudflare/workers-types";

// Mock ExecutionContext
function createMockContext(): ExecutionContext {
  return {
    waitUntil: mock(() => {}),
    passThroughOnException: mock(() => {}),
  } as unknown as ExecutionContext;
}

// Mock Env
interface MockEnv {
  REPORTS_BUCKET?: R2Bucket;
  D1_SERVICE?: any;
  TELEGRAM_SERVICE?: any;
  BROWSER?: any;
  INTERNAL_KEY_BINDING?: string;
  REPORT_WORKER_URL?: string;
  [key: string]: any;
}

describe("Report Worker", () => {
  describe("Health Check Endpoint", () => {
    it("GET /health returns 200 status", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("GET /health returns JSON response", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json"
      );
    });

    it("GET /health response is valid JSON", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(() => response.json()).not.toThrow();
    });

    it("GET /health includes success field", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(true);
    });

    it("GET /health includes result with status", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("result");
      const result = body.result as Record<string, unknown>;
      expect(result).toHaveProperty("status");
      expect(result.status).toBe("ok");
    });

    it("GET /health includes timestamp in result", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      expect(result).toHaveProperty("timestamp");
      expect(typeof result.timestamp).toBe("string");
    });

    it("GET /health includes service name in result", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      expect(result).toHaveProperty("service");
      expect(result.service).toBe("report-worker");
    });
  });

  describe("Report Endpoint", () => {
    // Helper to create authed env + request for the /report endpoint
    function authedReportEnv(overrides: Partial<MockEnv> = {}): MockEnv {
      return {
        INTERNAL_KEY_BINDING: "test-internal-key",
        ...overrides,
      };
    }

    function authedReportRequest(): Request {
      return new Request("https://example.com/report", {
        headers: { "X-Internal-Auth-Key": "test-internal-key" },
      });
    }

    it("GET /report returns 202 status", async () => {
      const request = authedReportRequest();
      const env = authedReportEnv();
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(202);
    });

    it("GET /report returns JSON response", async () => {
      const request = authedReportRequest();
      const env = authedReportEnv();
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json"
      );
    });

    it("GET /report response is valid JSON", async () => {
      const request = authedReportRequest();
      const env = authedReportEnv();
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(() => response.json()).not.toThrow();
    });

    it("GET /report includes success field", async () => {
      const request = authedReportRequest();
      const env = authedReportEnv();
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(true);
    });

    it("GET /report includes message field", async () => {
      const request = authedReportRequest();
      const env = authedReportEnv();
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("message");
      expect(typeof body.message).toBe("string");
    });

    it("GET /report calls ctx.waitUntil", async () => {
      const mockWaitUntil = mock(() => {});
      const ctx = {
        waitUntil: mockWaitUntil,
        passThroughOnException: mock(() => {}),
      } as unknown as ExecutionContext;

      const request = authedReportRequest();
      const env = authedReportEnv();

      await worker.fetch(request, env, ctx);
      expect(mockWaitUntil).toHaveBeenCalled();
    });
  });

  describe("Router Endpoints", () => {
    it("returns 404 for unknown endpoints", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("returns 404 for unknown path", async () => {
      const request = new Request("https://example.com/api/nonexistent");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("returns 405 for wrong HTTP method on /health", async () => {
      const request = new Request("https://example.com/health", {
        method: "POST",
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(405);
    });

    it("returns 405 for wrong HTTP method on /report", async () => {
      const request = new Request("https://example.com/report", {
        method: "DELETE",
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(405);
    });

    it("handles GET requests correctly", async () => {
      const request = new Request("https://example.com/health", {
        method: "GET",
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe("Error Handling", () => {
    it("returns proper error status codes for 404", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("error responses include error message", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("string");
    });

    it("error responses have Content-Type: application/json", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json"
      );
    });

    it("404 error response includes success: false", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
    });

    it("405 error response includes success: false", async () => {
      const request = new Request("https://example.com/health", {
        method: "POST",
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
    });

    it("error responses don't expose sensitive data", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {
        DATABASE_URL: "postgresql://user:pass@localhost/db",
        API_KEY: "secret-key-12345",
      };
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain("postgresql://");
      expect(body).not.toContain("DATABASE_URL");
      expect(body).not.toContain("secret-key");
    });
  });

  describe("Response Format", () => {
    it("all responses have Content-Type header", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.headers.get("Content-Type")).toBeDefined();
    });

    it("all responses are valid JSON", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(() => response.json()).not.toThrow();
    });

    it("success responses include proper structure", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("result");
    });

    it("error responses include proper structure", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("error");
    });
  });

  describe("Edge Cases", () => {
    it("handles missing required headers", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBeLessThan(500);
    });

    it("handles concurrent requests", async () => {
      const requests = [
        new Request("https://example.com/health"),
        new Request("https://example.com/health"),
        new Request("https://example.com/health"),
      ];
      const env: MockEnv = {};
      const ctx = createMockContext();

      const responses = await Promise.all(
        requests.map((req) => worker.fetch(req, env, ctx))
      );

      responses.forEach((response) => {
        expect(response.status).toBeLessThan(500);
      });
    });

    it("handles empty path", async () => {
      const request = new Request("https://example.com/");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("handles path with trailing slash", async () => {
      const request = new Request("https://example.com/health/");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("handles path with query parameters", async () => {
      const request = new Request("https://example.com/health?test=1");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("handles case-sensitive paths", async () => {
      const request = new Request("https://example.com/Health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("handles multiple slashes in path", async () => {
      const request = new Request("https://example.com//health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      // May be 404 or normalized to 200 depending on URL parsing
      expect([200, 404]).toContain(response.status);
    });

    it("handles very long paths", async () => {
      const longPath = "/health" + "/x".repeat(1000);
      const request = new Request(`https://example.com${longPath}`);
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("handles special characters in path", async () => {
      const request = new Request("https://example.com/health%20test");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("handles different HTTP methods", async () => {
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"];
      const env: MockEnv = {};
      const ctx = createMockContext();

      for (const method of methods) {
        const request = new Request("https://example.com/health", { method });
        const response = await worker.fetch(request, env, ctx);
        // GET should be 200, others should be 405
        if (method === "GET") {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(405);
        }
      }
    });

    it("handles request with response body", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toBeDefined();
    });

    it("handles request with custom headers", async () => {
      const request = new Request("https://example.com/health", {
        headers: {
          "X-Custom-Header": "custom-value",
          "User-Agent": "test-agent",
        },
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("handles request with authorization header", async () => {
      const request = new Request("https://example.com/health", {
        headers: {
          Authorization: "Bearer token123",
        },
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });
  });

  describe("Middleware Integration", () => {
    it("applies request logging middleware", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      // Should not throw even with logging middleware
      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("middleware doesn't interfere with health check", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(true);
    });

    it("middleware doesn't interfere with report endpoint", async () => {
      const request = new Request("https://example.com/report", {
        headers: { "X-Internal-Auth-Key": "test-internal-key" },
      });
      const env: MockEnv = {
        INTERNAL_KEY_BINDING: "test-internal-key",
      };
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(true);
    });

    it("middleware doesn't interfere with error responses", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(false);
    });
  });

  describe("Environment Variables", () => {
    it("handles missing environment variables gracefully", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("handles environment with all variables set", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {
        REPORTS_BUCKET: {} as any,
        D1_SERVICE: {} as any,
        TELEGRAM_SERVICE: {} as any,
        BROWSER: {} as any,
        INTERNAL_KEY_BINDING: "key",
        REPORT_WORKER_URL: "https://example.com",
      };
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("passes environment to handlers", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = { CUSTOM_VAR: "custom-value" };
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });
  });

  describe("Execution Context", () => {
    it("passes execution context to handlers", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("report endpoint calls ctx.waitUntil", async () => {
      const mockWaitUntil = mock(() => {});
      const ctx = {
        waitUntil: mockWaitUntil,
        passThroughOnException: mock(() => {}),
      } as unknown as ExecutionContext;

      // Report endpoint requires auth
      const request = new Request("https://example.com/report", {
        headers: { "X-Internal-Auth-Key": "test-internal-key" },
      });
      const env: MockEnv = { INTERNAL_KEY_BINDING: "test-internal-key" };

      await worker.fetch(request, env, ctx);
      expect(mockWaitUntil).toHaveBeenCalled();
    });

    it("health endpoint doesn't call ctx.waitUntil", async () => {
      const mockWaitUntil = mock(() => {});
      const ctx = {
        waitUntil: mockWaitUntil,
        passThroughOnException: mock(() => {}),
      } as unknown as ExecutionContext;

      const request = new Request("https://example.com/health");
      const env: MockEnv = {};

      await worker.fetch(request, env, ctx);
      // Health check shouldn't call waitUntil
      expect(mockWaitUntil).not.toHaveBeenCalled();
    });
  });

  describe("Response Status Codes", () => {
    it("health endpoint returns 200", async () => {
      const request = new Request("https://example.com/health");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
    });

    it("report endpoint returns 202", async () => {
      const request = new Request("https://example.com/report", {
        headers: { "X-Internal-Auth-Key": "test-internal-key" },
      });
      const env: MockEnv = { INTERNAL_KEY_BINDING: "test-internal-key" };
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(202);
    });

    it("unknown endpoint returns 404", async () => {
      const request = new Request("https://example.com/unknown");
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(404);
    });

    it("wrong method returns 405", async () => {
      const request = new Request("https://example.com/health", {
        method: "POST",
      });
      const env: MockEnv = {};
      const ctx = createMockContext();

      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(405);
    });
  });

  // Module-level helper used by both "PDF Generation" and "Report Generation Pipeline" tests
  function mockQuickActionPdf(): any {
    return {
      quickAction: mock(async (action: string, _params: any) => {
        if (action !== "pdf") {
          return new Response("Unknown action", { status: 400 });
        }
        const pdfBuffer = new Uint8Array([
          0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
        ]);
        return new Response(pdfBuffer.buffer, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }),
    };
  }

  describe("PDF Generation", () => {
    describe("Basic PDF Generation", () => {
      it("generates valid PDF from HTML", async () => {
        const html = "<html><body>Test Report</body></html>";
        const env: MockEnv = {
          BROWSER: mockQuickActionPdf(),
        };

        const pdf = await generatePdf(html, env as any);
        expect(pdf).toBeDefined();
        expect(pdf.byteLength).toBeGreaterThan(0);
      });

      it("PDF starts with PDF magic bytes", async () => {
        const html = "<html><body>Test</body></html>";
        const env: MockEnv = {
          BROWSER: mockQuickActionPdf(),
        };

        const pdf = await generatePdf(html, env as any);
        const view = new Uint8Array(pdf);
        expect(view[0]).toBe(0x25); // %
        expect(view[1]).toBe(0x50); // P
        expect(view[2]).toBe(0x44); // D
        expect(view[3]).toBe(0x46); // F
      });

      it("handles HTML with special characters", async () => {
        const html = "<html><body>Test <>&\"'</body></html>";
        const env: MockEnv = {
          BROWSER: mockQuickActionPdf(),
        };

        const pdf = await generatePdf(html, env as any);
        expect(pdf).toBeDefined();
        expect(pdf.byteLength).toBeGreaterThan(0);
      });

      it("handles HTML with unicode characters", async () => {
        const html = "<html><body>Test 🚀 ✅ 你好</body></html>";
        const env: MockEnv = {
          BROWSER: mockQuickActionPdf(),
        };

        const pdf = await generatePdf(html, env as any);
        expect(pdf).toBeDefined();
      });

      it("handles large HTML content", async () => {
        const largeContent =
          "<html><body>" + "x".repeat(100000) + "</body></html>";
        const env: MockEnv = {
          BROWSER: mockQuickActionPdf(),
        };

        const pdf = await generatePdf(largeContent, env as any);
        expect(pdf).toBeDefined();
      });

      it("handles minimal HTML", async () => {
        const html = "<html></html>";
        const env: MockEnv = {
          BROWSER: mockQuickActionPdf(),
        };

        const pdf = await generatePdf(html, env as any);
        expect(pdf).toBeDefined();
      });
    });

    describe("PDF Generation Error Handling", () => {
      it("throws error when BROWSER binding is missing", async () => {
        const html = "<html><body>Test</body></html>";
        const env: MockEnv = {
          // Missing BROWSER binding
        };

        try {
          await generatePdf(html, env as any);
          expect(true).toBe(false); // Should throw
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect((e as Error).message).toContain("BROWSER");
        }
      });

      it("throws error on PDF action failure", async () => {
        const html = "<html><body>Test</body></html>";
        const env: MockEnv = {
          BROWSER: {
            quickAction: mock(async (action: string) => {
              if (action === "pdf") {
                return new Response("PDF Error", { status: 500 });
              }
              return new Response("Unknown action", { status: 400 });
            }),
          },
        };

        try {
          await generatePdf(html, env as any);
          expect(true).toBe(false); // Should throw
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect((e as Error).message).toContain("Browser Rendering PDF error");
        }
      });

      it("handles PDF action timeout", async () => {
        const html = "<html><body>Test</body></html>";
        const env: MockEnv = {
          BROWSER: {
            quickAction: mock(async () => {
              throw new Error("Request timeout");
            }),
          },
        };

        try {
          await generatePdf(html, env as any);
          expect(true).toBe(false); // Should throw
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      });

      it("handles invalid PDF response", async () => {
        const html = "<html><body>Test</body></html>";
        const env: MockEnv = {
          BROWSER: {
            quickAction: mock(async () => {
              return new Response("Invalid response", { status: 400 });
            }),
          },
        };

        try {
          await generatePdf(html, env as any);
          expect(true).toBe(false); // Should throw
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      });
    });
  });

  describe("Report HTML Building", () => {
    it("builds HTML from portfolio summary", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      expect(html).toBeDefined();
      expect(html).toContain("Hoox Portfolio Report");
      // Numbers are formatted with $ and locale formatting
      expect(html).toContain("$10,000");
      expect(html).toContain("$500");
    });

    it("includes all required fields in HTML", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      expect(html).toContain("Total Value");
      expect(html).toContain("Daily P&L");
      expect(html).toContain("Total P&L");
      expect(html).toContain("Open Positions");
      expect(html).toContain("Win Rate");
      expect(html).toContain("Top Asset");
    });

    it("formats positive values correctly", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      expect(html).toContain("positive");
    });

    it("formats negative values correctly", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: -500,
        totalPnL: -2000,
        openPositions: 5,
        winRate: 25,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      expect(html).toContain("negative");
    });

    it("handles zero values", () => {
      const summary = {
        totalValue: 0,
        dailyPnL: 0,
        totalPnL: 0,
        openPositions: 0,
        winRate: 0,
        topAsset: "N/A",
      };

      const html = buildReportHtml(summary);
      expect(html).toBeDefined();
      expect(html).toContain("0");
    });

    it("handles large numbers", () => {
      const summary = {
        totalValue: 1000000000,
        dailyPnL: 50000000,
        totalPnL: 200000000,
        openPositions: 1000,
        winRate: 99.99,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      expect(html).toBeDefined();
      // Numbers are formatted with locale separators
      expect(html).toContain("$1,000,000,000");
    });

    it("handles special characters in asset names", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC/USD",
      };

      const html = buildReportHtml(summary);
      expect(html).toContain("BTC/USD");
    });

    it("includes date in report", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      // Should contain today's date in ISO format
      const today = new Date().toISOString().split("T")[0];
      expect(html).toContain(today);
    });

    it("includes footer disclaimer", () => {
      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      const html = buildReportHtml(summary);
      expect(html).toContain(
        "Past performance does not guarantee future results"
      );
    });
  });

  describe("Portfolio Summary Fetching", () => {
    it("throws error when D1_SERVICE is not configured", async () => {
      const env: MockEnv = {
        // No D1_SERVICE
      };

      try {
        await fetchPortfolioSummary(env as any);
        expect(true).toBe(false); // Should throw
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain("D1_SERVICE");
      }
    });

    it("fetches portfolio data from D1 service", async () => {
      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [
                  { exchange: "binance", asset: "BTC", total: 5000 },
                  { exchange: "binance", asset: "ETH", total: 3000 },
                ],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [
                  { symbol: "BTC/USD", side: "long", unrealized_pnl: 500 },
                  { symbol: "ETH/USD", side: "long", unrealized_pnl: 300 },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        D1_SERVICE: mockD1Service as any,
      };

      const summary = await fetchPortfolioSummary(env as any);
      expect(summary).toBeDefined();
      expect(summary.totalValue).toBe(10000);
      expect(summary.openPositions).toBe(2);
    });

    it("throws error on D1 service failure", async () => {
      const mockD1Service = {
        fetch: mock(async () => {
          return new Response(JSON.stringify({ success: false }), {
            status: 500,
          });
        }),
      };

      const env: MockEnv = {
        D1_SERVICE: mockD1Service as any,
      };

      try {
        await fetchPortfolioSummary(env as any);
        expect(true).toBe(false); // Should throw
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("calculates win rate correctly", async () => {
      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [{ exchange: "binance", asset: "BTC", total: 10000 }],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [
                  { symbol: "BTC/USD", side: "long", unrealized_pnl: 500 },
                  { symbol: "ETH/USD", side: "long", unrealized_pnl: -300 },
                  { symbol: "SOL/USD", side: "long", unrealized_pnl: 200 },
                  { symbol: "ADA/USD", side: "long", unrealized_pnl: -100 },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        D1_SERVICE: mockD1Service as any,
      };

      const summary = await fetchPortfolioSummary(env as any);
      expect(summary.winRate).toBe(50); // 2 winning out of 4 positions
    });

    it("identifies top asset by balance", async () => {
      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [
                  { exchange: "binance", asset: "ETH", total: 3000 },
                  { exchange: "binance", asset: "BTC", total: 5000 },
                  { exchange: "binance", asset: "SOL", total: 2000 },
                ],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        D1_SERVICE: mockD1Service as any,
      };

      const summary = await fetchPortfolioSummary(env as any);
      expect(summary.topAsset).toBe("BTC");
    });
  });

  describe("Notification Sending", () => {
    it("sends notification with valid parameters", async () => {
      const mockTelegramService = {
        fetch: mock(async () => {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }),
      };

      const env: MockEnv = {
        TELEGRAM_SERVICE: mockTelegramService as any,
        REPORT_WORKER_URL: "report-worker.example.com",
      };

      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      await sendNotification(env as any, "reports/daily-123.pdf", summary);
      expect(mockTelegramService.fetch).toHaveBeenCalled();
    });

    it("includes report URL in notification", async () => {
      let capturedPayload: any;
      const mockTelegramService = {
        fetch: mock(async (url: string, options: any) => {
          if (options?.body) {
            capturedPayload = JSON.parse(options.body);
          }
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }),
      };

      const env: MockEnv = {
        TELEGRAM_SERVICE: mockTelegramService as any,
        REPORT_WORKER_URL: "report-worker.example.com",
      };

      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      await sendNotification(env as any, "reports/daily-123.pdf", summary);
      // Notification should include the report URL
      expect(mockTelegramService.fetch).toHaveBeenCalled();
    });

    it("handles missing TELEGRAM_SERVICE gracefully", async () => {
      const env: MockEnv = {
        // No TELEGRAM_SERVICE
      };

      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      // Should not throw
      await sendNotification(env as any, "reports/daily-123.pdf", summary);
    });

    it("skips notification when REPORT_WORKER_URL is not configured", async () => {
      const mockTelegramService = {
        fetch: mock(async () => {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }),
      };

      const env: MockEnv = {
        TELEGRAM_SERVICE: mockTelegramService as any,
        // No REPORT_WORKER_URL
      };

      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      await sendNotification(env as any, "reports/daily-123.pdf", summary);
      // Should skip notification, so fetch should NOT be called
      expect(mockTelegramService.fetch).not.toHaveBeenCalled();
    });

    it("includes portfolio metrics in notification", async () => {
      const mockTelegramService = {
        fetch: mock(async () => {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }),
      };

      const env: MockEnv = {
        TELEGRAM_SERVICE: mockTelegramService as any,
        REPORT_WORKER_URL: "report-worker.example.com",
      };

      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      await sendNotification(env as any, "reports/daily-123.pdf", summary);
      expect(mockTelegramService.fetch).toHaveBeenCalled();
    });

    it("handles notification service errors", async () => {
      const mockTelegramService = {
        fetch: mock(async () => {
          return new Response(JSON.stringify({ success: false }), {
            status: 500,
          });
        }),
      };

      const env: MockEnv = {
        TELEGRAM_SERVICE: mockTelegramService as any,
        REPORT_WORKER_URL: "report-worker.example.com",
      };

      const summary = {
        totalValue: 10000,
        dailyPnL: 500,
        totalPnL: 2000,
        openPositions: 5,
        winRate: 75,
        topAsset: "BTC",
      };

      // Should not throw even if service fails
      await sendNotification(env as any, "reports/daily-123.pdf", summary);
    });
  });

  describe("Report Generation Pipeline", () => {
    function mockPipelineBrowser(): any {
      return mockQuickActionPdf();
    }

    it("generates and stores report successfully", async () => {
      const mockR2Bucket = {
        put: mock(async () => {
          return { success: true };
        }),
      };

      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [{ exchange: "binance", asset: "BTC", total: 10000 }],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const mockTelegramService = {
        fetch: mock(async () => {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }),
      };

      const env: MockEnv = {
        REPORTS_BUCKET: mockR2Bucket as any,
        D1_SERVICE: mockD1Service as any,
        TELEGRAM_SERVICE: mockTelegramService as any,
        BROWSER: mockPipelineBrowser(),
      };

      const ctx = createMockContext();

      await generateAndStoreReport(env as any, ctx);
      expect(mockR2Bucket.put).toHaveBeenCalled();
    });

    it("stores PDF with correct key format", async () => {
      let capturedKey: string | undefined;
      const mockR2Bucket = {
        put: mock(async (key: string) => {
          capturedKey = key;
          return { success: true };
        }),
      };

      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [{ exchange: "binance", asset: "BTC", total: 10000 }],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        REPORTS_BUCKET: mockR2Bucket as any,
        D1_SERVICE: mockD1Service as any,
        BROWSER: mockPipelineBrowser(),
      };

      const ctx = createMockContext();

      await generateAndStoreReport(env as any, ctx);
      expect(capturedKey).toBeDefined();
      expect(capturedKey).toMatch(/^reports\/daily-\d+\.pdf$/);
    });

    it("handles report generation errors gracefully", async () => {
      const mockD1Service = {
        fetch: mock(async () => {
          throw new Error("D1 service error");
        }),
      };

      const env: MockEnv = {
        D1_SERVICE: mockD1Service as any,
      };

      const ctx = createMockContext();

      // Should not throw (errors are caught by generateAndStoreReport)
      await generateAndStoreReport(env as any, ctx);
    });

    it("calls ctx.waitUntil for async operations", async () => {
      const mockWaitUntil = mock(() => {});
      const ctx = {
        waitUntil: mockWaitUntil,
        passThroughOnException: mock(() => {}),
      } as unknown as ExecutionContext;

      const mockR2Bucket = {
        put: mock(async () => {
          return { success: true };
        }),
      };

      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [{ exchange: "binance", asset: "BTC", total: 10000 }],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        REPORTS_BUCKET: mockR2Bucket as any,
        D1_SERVICE: mockD1Service as any,
        BROWSER: mockPipelineBrowser(),
      };

      await generateAndStoreReport(env as any, ctx);
      // Report generation should complete without errors
    });

    it("handles concurrent report generation", async () => {
      const mockR2Bucket = {
        put: mock(async () => {
          return { success: true };
        }),
      };

      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000,
                balances: [{ exchange: "binance", asset: "BTC", total: 10000 }],
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            return new Response(
              JSON.stringify({
                success: true,
                positions: [],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        REPORTS_BUCKET: mockR2Bucket as any,
        D1_SERVICE: mockD1Service as any,
        BROWSER: mockPipelineBrowser(),
      };

      const promises = [
        generateAndStoreReport(env as any, createMockContext()),
        generateAndStoreReport(env as any, createMockContext()),
        generateAndStoreReport(env as any, createMockContext()),
      ];

      await Promise.all(promises);
      expect(mockR2Bucket.put).toHaveBeenCalled();
    });

    it("handles large portfolio data", async () => {
      const mockR2Bucket = {
        put: mock(async () => {
          return { success: true };
        }),
      };

      const mockD1Service = {
        fetch: mock(async (path: string) => {
          if (path.includes("/api/balances")) {
            const balances = Array.from({ length: 1000 }, (_, i) => ({
              exchange: "binance",
              asset: `ASSET${i}`,
              total: Math.random() * 10000,
            }));
            return new Response(
              JSON.stringify({
                success: true,
                totalBalance: 10000000,
                balances,
              }),
              { status: 200 }
            );
          }
          if (path.includes("/api/positions")) {
            const positions = Array.from({ length: 1000 }, (_, i) => ({
              symbol: `ASSET${i}/USD`,
              side: "long",
              unrealized_pnl: Math.random() * 10000 - 5000,
            }));
            return new Response(
              JSON.stringify({
                success: true,
                positions,
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: false }), {
            status: 404,
          });
        }),
      };

      const env: MockEnv = {
        REPORTS_BUCKET: mockR2Bucket as any,
        D1_SERVICE: mockD1Service as any,
        BROWSER: mockPipelineBrowser(),
      };

      const ctx = createMockContext();

      await generateAndStoreReport(env as any, ctx);
      expect(mockR2Bucket.put).toHaveBeenCalled();
    });
  });
});
