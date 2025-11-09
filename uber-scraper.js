import { chromium } from "playwright";
import { promises as fs } from "fs";

const FILTERED_URL =
  "https://www.uber.com/us/en/careers/list/?location=USA-California-San%20Francisco&location=USA-California-Los%20Angeles&location=USA-Illinois-Chicago&location=USA-Washington-Seattle&location=USA-Florida-Miami&location=USA-New%20York-New%20York&location=USA-Texas-Dallas&location=USA-California-Sunnyvale&location=USA-District%20of%20Columbia-Washington&location=USA-Georgia-Atlanta&location=USA-Massachusetts-Boston&department=Business%20Development&department=Product";

const OUTPUT_CSV = "uber_jobs_filtered.csv";

// --- Small CSV helper ---
function toCsvField(value: string): string {
  const v = value ?? "";
  const escaped = v.replace(/"/g, '""');
  return `"${escaped}"`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Opening filtered URL…");
  await page.goto(FILTERED_URL, { waitUntil: "networkidle" });

  // If there is a cookie banner, you can handle it here (selectors may differ):
  // const accept = page.getByRole("button", { name: /accept/i });
  // if (await accept.isVisible().catch(() => false)) {
  //   await accept.click();
  //   await page.waitForTimeout(1000);
  // }

  // --- Click "Show more roles" until the button disappears ---
  while (true) {
    const showMore = page.getByRole("button", { name: /show more roles/i });

    const visible = await showMore
      .isVisible()
      .catch(() => false); // if Playwright can't find it, treat as not visible

    if (!visible) break;

    console.log("Clicking 'Show more roles'…");
    await showMore.click();
    await page.waitForTimeout(2000); // give new roles time to load
  }

  const scrapedAt = new Date().toISOString();

  // --- Scrape all job links now visible in the DOM ---
  const jobs = await page.$$eval(
    "a[aria-label][href*='/careers/list/']",
    (links, scrapedAtStr) => {
      return (links as any[]).map((el) => {
        const a = el as any;
        const title = (a.textContent || "").trim();
        const url = a.href as string;
        const ariaLabel = (a.getAttribute && a.getAttribute("aria-label")) || "";

        // Try to capture the row's full text (location, team, etc.)
        const row =
          (a.closest && a.closest("[role='row']")) ||
          (a.closest && a.closest("li")) ||
          a.parentElement;

        const rowText = row
          ? (row.textContent || "").replace(/\s+/g, " ").trim()
          : "";

        return {
          title,
          url,
          ariaLabel,
          rowText,
          scrapedAt: scrapedAtStr as string,
        };
      });
    },
    scrapedAt
  );

  await browser.close();

  console.log(`Scraped ${jobs.length} jobs. Writing CSV…`);

  // --- Build CSV ---
  const header = ["title", "url", "ariaLabel", "rowText", "scrapedAt"];
  const lines: string[] = [];

  lines.push(header.map(toCsvField).join(","));

  for (const job of jobs) {
    lines.push(
      [
        toCsvField(job.title),
        toCsvField(job.url),
        toCsvField(job.ariaLabel),
        toCsvField(job.rowText),
        toCsvField(job.scrapedAt),
      ].join(",")
    );
  }

  await fs.writeFile(OUTPUT_CSV, lines.join("\n"), "utf8");

  console.log(`Done. Saved to ${OUTPUT_CSV}`);
}

main().catch((err) => {
  console.error("Error in scraper:", err);
  process.exit(1);
});
