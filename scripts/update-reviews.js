#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const REVIEWS_PATH = path.resolve(__dirname, '../src/reviews.html');
const AIRBNB_URL   = 'https://www.airbnb.com/rooms/1477018601970190586/reviews';
const VRBO_URL     = 'https://www.vrbo.com/4906384?dateless=true&pwaDialog=product-reviews';

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── helpers ───────────────────────────────────────────────────────────────────

function stars(n) {
  return '★'.repeat(Math.min(5, Math.max(1, Math.round(n || 5))));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── parse / build reviews.html ────────────────────────────────────────────────

function parseExistingReviews() {
  if (!fs.existsSync(REVIEWS_PATH)) return [];
  const html = fs.readFileSync(REVIEWS_PATH, 'utf8');
  const reviews = [];

  for (const m of html.matchAll(
    /<div class="review-slide[^"]*">([\s\S]*?)<\/cite>\s*<\/div>/g
  )) {
    const block  = m[1];
    const textM  = block.match(/<blockquote class="review-quote">"([\s\S]*?)"<\/blockquote>/);
    const nameM  = block.match(/<strong>([^<]+)<\/strong>/);
    const metaM  = block.match(/<span class="review-meta">([^<]+)<\/span>/);
    const starsM = block.match(/<span class="review-stars">(★+)/);

    if (!textM || !nameM) continue;

    // meta content looks like: "· Airbnb" or "· Airbnb · Winchester, VA"
    const parts    = metaM ? metaM[1].split(' · ').filter(Boolean) : ['Airbnb'];
    reviews.push({
      name:     nameM[1].trim(),
      text:     textM[1].trim(),
      platform: parts[0] || 'Airbnb',
      location: parts[1] || '',
      rating:   starsM ? starsM[1].length : 5,
    });
  }
  return reviews;
}

function buildHtml(reviews) {
  const slides = reviews.map((r, i) => {
    const meta = r.location
      ? `· ${r.platform} · ${r.location}`
      : `· ${r.platform}`;
    return [
      `    <div class="review-slide${i === 0 ? ' active' : ''}">`,
      `        <blockquote class="review-quote">"${escapeHtml(r.text)}"</blockquote>`,
      `        <cite class="review-author"><span class="review-stars">${stars(r.rating)}</span> <strong>${escapeHtml(r.name)}</strong> <span class="review-meta">${meta}</span></cite>`,
      `    </div>`,
    ].join('\n');
  }).join('\n');

  const dots = reviews.map((_, i) =>
    `    <button class="carousel-dot${i === 0 ? ' active' : ''}" aria-label="Review ${i + 1}"></button>`
  ).join('\n');

  return (
    `<div class="reviews-carousel" id="reviewsCarousel">\n` +
    `${slides}\n` +
    `</div>\n` +
    `<div class="carousel-dots" id="carouselDots">\n` +
    `${dots}\n` +
    `</div>\n`
  );
}

// ── JSON extraction (handles both Airbnb v2 REST and VRBO shapes) ─────────────

function extractFromJson(json, platform) {
  const reviews = [];

  // Airbnb REST v2: { reviews: [...] }
  if (Array.isArray(json?.reviews)) {
    for (const r of json.reviews) {
      const text = (r.comments || r.body || '').trim();
      if (!text) continue;
      reviews.push({
        name:     r.reviewer?.first_name || r.reviewer?.name || 'Guest',
        text,
        platform,
        location: r.reviewer?.location || '',
        rating:   typeof r.rating === 'number' ? r.rating : 5,
      });
    }
  }

  // VRBO / generic shapes
  if (!reviews.length) {
    const items =
      json?.data?.reviews?.reviews ||
      json?.reviewDetails?.reviews ||
      json?.data?.reviewDetails?.reviews ||
      [];
    for (const r of items) {
      const text = (r.reviewText || r.body || r.text || '').trim();
      const name = r.reviewerName || r.reviewer?.displayName || r.authorName || 'Guest';
      if (!text) continue;
      reviews.push({
        name,
        text,
        platform,
        location: r.reviewer?.location || '',
        rating:   typeof (r.overallRating ?? r.rating) === 'number'
          ? (r.overallRating ?? r.rating)
          : 5,
      });
    }
  }

  return reviews;
}

// ── scrape a single platform ──────────────────────────────────────────────────

async function scrapeReviews(browser, url, platform) {
  const reviews = [];
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport:  { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Intercept any request whose URL contains "review" (case-insensitive),
  // capture JSON responses, then let the request proceed normally.
  await page.route(
    (u) => u.toLowerCase().includes('review'),
    async (route) => {
      let response;
      try {
        response = await route.fetch();
      } catch {
        await route.continue();
        return;
      }

      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json')) {
        try {
          const body = await response.text();
          const json = JSON.parse(body);
          reviews.push(...extractFromJson(json, platform));
        } catch { /* non-JSON or unexpected shape */ }
      }

      await route.fulfill({ response });
    }
  );

  try {
    console.log(`  → ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000); // allow any deferred API calls to settle
  } catch (e) {
    console.warn(`  Warning (${platform}): ${e.message}`);
  }

  // DOM fallback if network interception yielded nothing
  if (!reviews.length) {
    console.log(`  No API reviews captured for ${platform} — trying DOM fallback...`);
    try {
      const domReviews = await page.evaluate((p) => {
        const results = [];
        const candidates = [
          ...document.querySelectorAll(
            '[data-testid*="review"], [class*="ReviewCard"], [aria-label*="review"], [class*="review-item"]'
          ),
        ];
        for (const el of candidates) {
          const text = (
            el.querySelector('[class*="comment"], [class*="review-text"], p')
              ?.textContent || ''
          ).trim();
          const name = (
            el.querySelector('[class*="reviewer"], [class*="author"], h3, h4')
              ?.textContent || ''
          ).trim().split('\n')[0];
          if (text.length > 20 && name) {
            results.push({ name, text, platform: p, location: '', rating: 5 });
          }
        }
        return results;
      }, platform);
      reviews.push(...domReviews);
    } catch (e) {
      console.warn(`  DOM fallback failed (${platform}): ${e.message}`);
    }
  }

  await context.close();

  // Deduplicate within this batch by name
  const seen = new Set();
  return reviews.filter((r) => {
    const key = r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('Parsing existing reviews...');
  const existing     = parseExistingReviews();
  const existingKeys = new Set(existing.map((r) => r.name.toLowerCase()));
  console.log(`  ${existing.length} existing: ${existing.map((r) => r.name).join(', ') || '(none)'}`);

  const browser = await chromium.launch({ args: BROWSER_ARGS });
  let airbnbReviews = [];
  let vrboReviews   = [];

  try {
    console.log('\nFetching Airbnb reviews...');
    airbnbReviews = await scrapeReviews(browser, AIRBNB_URL, 'Airbnb');
    console.log(`  ${airbnbReviews.length} found: ${airbnbReviews.map((r) => r.name).join(', ') || '(none)'}`);

    console.log('\nFetching VRBO reviews...');
    vrboReviews = await scrapeReviews(browser, VRBO_URL, 'VRBO');
    console.log(`  ${vrboReviews.length} found: ${vrboReviews.map((r) => r.name).join(', ') || '(none)'}`);
  } finally {
    await browser.close();
  }

  const newReviews = [...airbnbReviews, ...vrboReviews].filter(
    (r) => !existingKeys.has(r.name.toLowerCase())
  );

  if (!newReviews.length) {
    console.log('\nNo new reviews — reviews.html unchanged.');
    process.exit(0);
  }

  console.log(`\nNew reviews: ${newReviews.map((r) => r.name).join(', ')}`);
  const allReviews = [...existing, ...newReviews];
  fs.writeFileSync(REVIEWS_PATH, buildHtml(allReviews), 'utf8');
  console.log(`reviews.html updated — ${allReviews.length} total reviews.`);
})();
