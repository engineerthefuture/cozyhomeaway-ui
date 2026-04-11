#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
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

// ── JSON extraction — recursive search through any JSON shape ────────────────

// Returns a review object if `obj` looks like a single review, otherwise null.
function tryParseReview(obj, platform) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const text =
    (typeof obj.comments    === 'string' ? obj.comments    : null) ||
    (typeof obj.reviewText  === 'string' ? obj.reviewText  : null) ||
    (typeof obj.body        === 'string' ? obj.body        : null);

  if (!text || text.trim().length < 10) return null;

  const rev  = (obj.reviewer && typeof obj.reviewer === 'object') ? obj.reviewer : obj;
  const name =
    rev.first_name || rev.firstName || rev.displayName ||
    obj.reviewerName || obj.authorName || obj.guestName;

  if (!name) return null;

  return {
    name:     String(name).trim(),
    text:     text.trim(),
    platform,
    location: (obj.reviewer && obj.reviewer.location) || obj.location || '',
    rating:   typeof (obj.rating ?? obj.overallRating) === 'number'
      ? (obj.rating ?? obj.overallRating) : 5,
  };
}

function findReviewsInJson(obj, platform, depth) {
  if (depth > 14 || obj === null || typeof obj !== 'object') return [];

  // Maybe this node itself is a review
  const asReview = tryParseReview(obj, platform);
  if (asReview) return [asReview];

  const results = [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...findReviewsInJson(item, platform, depth + 1));
    }
  } else {
    // Prioritise keys likely to contain review data
    const priorityKeys = [
      'reviews', 'reviewsList', 'reviewComments', 'reviewDetails',
      'sections', 'data', 'presentation', 'pdpReviews',
    ];
    const allKeys = Object.keys(obj);
    const ordered = [
      ...priorityKeys.filter(k => allKeys.includes(k)),
      ...allKeys.filter(k => !priorityKeys.includes(k)),
    ];
    for (const key of ordered) {
      const val = obj[key];
      if (val && typeof val === 'object') {
        results.push(...findReviewsInJson(val, platform, depth + 1));
      }
    }
  }
  return results;
}

// ── scrape a single platform ──────────────────────────────────────────────────

async function scrapeReviews(browser, url, platform) {
  const reviews = [];
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport:  { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Intercept all XHR/fetch requests — Airbnb uses GraphQL where the operation
  // name is in the POST body, not the URL, so URL-based filtering misses it.
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) {
      await route.continue();
      return;
    }

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
        const found = findReviewsInJson(json, platform, 0);
        if (found.length) {
          const pathname = (() => { try { return new URL(req.url()).pathname; } catch { return req.url(); } })();
          console.log(`  Captured ${found.length} review(s) from: ${pathname}`);
          reviews.push(...found);
        }
      } catch { /* ignore parse errors */ }
    }

    await route.fulfill({ response });
  });

  try {
    console.log(`  → ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.warn(`  Warning (${platform}): ${e.message}`);
  }

  console.log(`  Page loaded: "${await page.title()}" (${page.url()})`);

  // Airbnb shows reviews in a vertically-scrollable modal. Scroll inside it
  // repeatedly to trigger lazy-loading of additional reviews.
  const SCROLL_ATTEMPTS = 30;
  for (let i = 0; i < SCROLL_ATTEMPTS; i++) {
    const countBefore = reviews.length;

    // Scroll the modal if present, otherwise scroll the page body.
    await page.evaluate(() => {
      const modalSelectors = [
        '[data-testid="modal-container"]',
        '[data-testid="reviews-modal"]',
        '[role="dialog"]',
        '[class*="modal"]',
        '[class*="Modal"]',
      ];
      let scrollTarget = null;
      for (const sel of modalSelectors) {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight) {
          scrollTarget = el;
          break;
        }
      }
      if (scrollTarget) {
        scrollTarget.scrollTop = scrollTarget.scrollHeight;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    });

    await page.waitForTimeout(1500);

    // Stop early if the last two scroll attempts added nothing new.
    if (reviews.length === countBefore && i > 2) {
      console.log(`  No new reviews after scroll ${i + 1} — stopping`);
      break;
    }
    if (reviews.length > countBefore) {
      console.log(`  Scroll ${i + 1}: total captured so far: ${reviews.length}`);
    }
  }

  // __NEXT_DATA__ fallback — Airbnb and VRBO are Next.js apps that embed all
  // page data as JSON in a <script id="__NEXT_DATA__"> tag.
  if (!reviews.length) {
    try {
      const nextData = await page.$eval('#__NEXT_DATA__', el => JSON.parse(el.textContent));
      const found = findReviewsInJson(nextData, platform, 0);
      if (found.length) {
        console.log(`  Found ${found.length} reviews in __NEXT_DATA__`);
        reviews.push(...found);
      }
    } catch { /* page doesn't have __NEXT_DATA__ */ }
  }

  // DOM fallback
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
