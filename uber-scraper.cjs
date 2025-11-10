// uber-scraper.cjs
// Scrapes filtered Uber roles and saves them to uber_jobs_filtered.csv

const { chromium } = require("playwright");
const fs = require("fs").promises;
const path = require("path");

// === CONFIG (edit when reusing for another company) ===
const CONFIG = {
  company: "Uber",
  filteredUrl:
    "https://www.uber.com/us/en/careers/list/?location=USA-California-San%20Francisco&location=USA-California-Los%20Angeles&location=USA-Illinois-Chicago&location=USA-Washington-Seattle&location=USA-Florida-Miami&location=USA-New%20York-New%20York&location=USA-Texas-Dallas&location=USA-California-Sunnyvale&location=USA-District%20of%20Columbia-Washington&location=USA-Georgia-Atlanta&location=USA-Massachusetts-Boston&department=Business%20Development&department=Product",
  outputFile: "uber_jobs_filtered.csv",

  // Exact text on Uber’s button (you can change this per site)
  showMoreText: /show more openings/i,

  // Selector to find job links
  roleLinkSelector: "a[aria-label][href*='/careers/list/']",
};

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
  await page.goto(CONFIG.filteredUrl, { waitUntil: "networkidle" });

  // Cookie banner (best-effort)
  try {
    const acceptButton = page.locator("button", { hasText: /accept/i });
    if (await acceptButton.isVisible().catch(() => false)) {
      console.log("Clicking cookie consent button…");
      await acceptButton.click();
      await page.waitForTimeout(1000);
    }
  } catch {}

  // Feedback popup (best-effort)
  try {
    const feedbackClose = page.locator("button[aria-label*='close' i]");
    if (await feedbackClose.isVisible().catch(() => false)) {
      console.log("Closing feedback popup…");
      await feedbackClose.click();
      await page.waitForTimeout(500);
    }
  } catch {}

  // --- Click “Show more openings” until count stops increasing ---
  let lastCount = await page.$$eval(CONFIG.roleLinkSelector, (links) => links.length);
  console.log(`Initial roles visible: ${lastCount}`);
  let clickCount = 0;
  const MAX_CLICKS = 30;

  while (clickCount < MAX_CLICKS) {
    const showMore = page.getByRole("button", { name: CONFIG.showMoreText });

    let visible = false;
    try {
      visible = await showMore.isVisible();
    } catch {
      visible = false;
    }

    if (!visible) {
      console.log("No 'Show more openings' button visible, stopping.");
      break;
    }

    console.log(`Clicking 'Show more openings' (click #${clickCount + 1})…`);
    await showMore.click();
    await page.waitForTimeout(2000);

    const newCount = await page.$$eval(
      CONFIG.roleLinkSelector,
      (links) => links.length
    );
    console.log(`Roles before: ${lastCount}, after: ${newCount}`);

    if (newCount <= lastCount) {
      console.log("Role count did not increase; assuming no more results.");
      break;
    }

    lastCount = newCount;
    clickCount++;
  }

  if (clickCount >= MAX_CLICKS) {
    console.log("Hit MAX_CLICKS safety limit; stopping clicks.");
  }

  const scrapedAt = new Date().toISOString();

  // --- Extract roles; filter out non-job links + parse sub-team ---
  const jobs = await page.$$eval(
    CONFIG.roleLinkSelector,
    (links, meta) => {
      const { scrapedAtStr, company } = meta;

      function isRealJobUrl(urlString) {
        try {
          const u = new URL(urlString);
          const parts = u.pathname.split("/").filter(Boolean);
          const last = parts[parts.length - 1] || "";
          return /^\d+$/.test(last); // numeric job ID
        } catch {
          return false;
        }
      }

      function extractSubTeam(rowText) {
        const normalized = rowText.replace(/\s+/g, " ").trim();
        const subIdx = normalized.indexOf("Sub-Team");
        if (subIdx === -1) return "";
        const locIdx = normalized.indexOf("Location", subIdx + 8);
        const start = subIdx + "Sub-Team".length;
        const end = locIdx === -1 ? normalized.length : locIdx;
        return normalized.slice(start, end).trim();
      }

      const results = [];
      for (const el of links) {
        const a = el;
        const title = (a.textContent || "").trim();
        const url = a.href;

        if (!isRealJobUrl(url)) continue; // drop footer / "job search" etc.

        const ariaLabel = a.getAttribute("aria-label") || "";
        const row =
          a.closest("[role='row']") ||
          a.closest("li") ||
          a.parentElement;
        const rowText = row
          ? (row.textContent || "").replace(/\s+/g, " ").trim()
          : "";

        const subTeam = extractSubTeam(rowText);

        results.push({
          company,
          title,
          subTeam,
          url,
          ariaLabel,
          rowText,
          scrapedAt: scrapedAtStr,
        });
      }
      return results;
    },
    { scrapedAtStr: scrapedAt, company: CONFIG.company }
  );

  console.log(`Raw scraped roles: ${jobs.length}`);

  await browser.close();

  // De-duplicate by URL
  const seen = new Set();
  const uniqueJobs = [];
  for (const job of jobs) {
    if (seen.has(job.url)) continue;
    seen.add(job.url);
    uniqueJobs.push(job);
  }

  console.log(`Unique roles after de-dupe: ${uniqueJobs.length}`);

  // --- Build CSV (with company + subTeam) ---
  const header = [
    "company",
    "title",
    "subTeam",
    "url",
    "ariaLabel",
    "rowText",
    "scrapedAt",
  ];
  const lines = [];
  lines.push(header.map(csvCell).join(","));

  for (const job of uniqueJobs) {
    lines.push(
      [
        csvCell(job.company),
        csvCell(job.title),
        csvCell(job.subTeam),
        csvCell(job.url),
        csvCell(job.ariaLabel),
        csvCell(job.rowText),
        csvCell(job.scrapedAt),
      ].join(",")
    );
  }

  const outPath = path.join(process.cwd(), CONFIG.outputFile);
  await fs.writeFile(outPath, lines.join("\n"), "utf8");

  console.log(`Saved CSV with ${uniqueJobs.length} roles to: ${outPath}`);
})().catch((err) => {
  console.error("FATAL error in scraper:", err);
  process.exit(1);
});
