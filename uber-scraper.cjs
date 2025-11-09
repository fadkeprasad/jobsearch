// uber-scraper.cjs
// Scrapes filtered Uber roles and saves them to uber_jobs_filtered.csv

const { chromium } = require("playwright");
const fs = require("fs").promises;
const path = require("path");

// === EDIT THIS URL IF YOU CHANGE FILTERS IN FUTURE ===
const FILTERED_URL =
  "https://www.uber.com/us/en/careers/list/?location=USA-California-San%20Francisco&location=USA-California-Los%20Angeles&location=USA-Illinois-Chicago&location=USA-Washington-Seattle&location=USA-Florida-Miami&location=USA-New%20York-New%20York&location=USA-Texas-Dallas&location=USA-California-Sunnyvale&location=USA-District%20of%20Columbia-Washington&location=USA-Georgia-Atlanta&location=USA-Georgia-Atlanta&location=USA-Massachusetts-Boston&department=Business%20Development&department=Product";

const OUTPUT_FILE = "uber_jobs_filtered.csv";

// CSV escaping helper
function csvCell(value) {
  const v = value == null ? "" : String(value);
  return `"${v.replace(/"/g, '""')}"`;
}

(async () => {
  console.log("Launching Chromium…");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Opening filtered URL…");
  await page.goto(FILTERED_URL, { waitUntil: "networkidle" });

  // --- Best-effort cookie banner close (safe if nothing is there) ---
  try {
    const acceptButton = page.locator("button", { hasText: /accept/i });
    if (await acceptButton.isVisible().catch(() => false)) {
      console.log("Clicking cookie consent button…");
      await acceptButton.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    /* ignore */
  }

  // --- Best-effort close of feedback popup if it exists ---
  try {
    const feedbackClose = page.locator("button[aria-label*='close' i]");
    if (await feedbackClose.isVisible().catch(() => false)) {
      console.log("Closing feedback popup…");
      await feedbackClose.click();
      await page.waitForTimeout(500);
    }
  } catch {
    /* ignore */
  }

  // --- Click "Show more openings" until it's gone ---
  while (true) {
    // Try a few variants to be resilient to text changes
    const showMore = page.locator("button", {
      hasText: /show more openings?|show more/i,
    });

    let visible = false;
    try {
      visible = await showMore.isVisible();
    } catch {
      visible = false;
    }

    if (!visible) {
      console.log("No 'Show more' button visible. Assuming all roles loaded.");
      break;
    }

    console.log("Clicking 'Show more' button…");
    await showMore.click();

    // Wait for new roles to load/render
    await page.waitForTimeout(2000);
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
      // networkidle timeout is fine; just move on
    }
  }

  const scrapedAt = new Date().toISOString();

  // --- Extract roles from DOM ---
  const jobs = await page.$$eval(
    "a[aria-label][href*='/careers/list/']",
    (links, scrapedAtStr) => {
      const results = [];
      for (const el of links) {
        const a = el;
        const title = (a.textContent || "").trim();
        const url = a.href;
        const ariaLabel = a.getAttribute("aria-label") || "";

        const row =
          a.closest("[role='row']") ||
          a.closest("li") ||
          a.parentElement;

        const rowText = row
          ? (row.textContent || "").replace(/\s+/g, " ").trim()
          : "";

        results.push({
          title,
          url,
          ariaLabel,
          rowText,
          scrapedAt: scrapedAtStr,
        });
      }
      return results;
    },
    scrapedAt
  );

  console.log(`Raw scraped roles: ${jobs.length}`);

  await browser.close();

  // --- De-duplicate by job URL ---
  const seen = new Set();
  const uniqueJobs = [];
  for (const job of jobs) {
    if (seen.has(job.url)) continue;
    seen.add(job.url);
    uniqueJobs.push(job);
  }

  console.log(`Unique roles after de-dupe: ${uniqueJobs.length}`);

  // --- Build CSV ---
  const header = ["title", "url", "ariaLabel", "rowText", "scrapedAt"];
  const lines = [];

  lines.push(header.map(csvCell).join(","));

  for (const job of uniqueJobs) {
    lines.push(
      [
        csvCell(job.title),
        csvCell(job.url),
        csvCell(job.ariaLabel),
        csvCell(job.rowText),
        csvCell(job.scrapedAt),
      ].join(",")
    );
  }

  const outPath = path.join(process.cwd(), OUTPUT_FILE);
  await fs.writeFile(outPath, lines.join("\n"), "utf8");

  console.log(`Saved CSV with ${uniqueJobs.length} roles to: ${outPath}`);
})().catch((err) => {
  console.error("FATAL error in scraper:", err);
  process.exit(1);
});
