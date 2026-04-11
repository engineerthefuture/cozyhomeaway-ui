#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const fs   = require('fs');
const path = require('path');

const REVIEWS_PATH    = path.resolve(__dirname, '../src/reviews.html');
const AIRBNB_URL      = 'https://www.airbnb.com/rooms/1477018601970190586/reviews';
const VRBO_LISTING_ID = '4906384';
const VRBO_PAGE_URL   = `https://www.vrbo.com/${VRBO_LISTING_ID}?dateless=true`;

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
    // Strip the leading "· " bullet before splitting on remaining " · " delimiters.
    const metaRaw  = metaM ? metaM[1].replace(/^·\s*/, '') : 'Airbnb';
    const parts    = metaRaw.split(' · ').filter(Boolean);
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

// ── JSON extraction ──────────────────────────────────────────────────────────

function tryParseReview(obj, platform) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const text =
    (typeof obj.comments    === 'string' ? obj.comments    : null) ||
    (typeof obj.reviewText  === 'string' ? obj.reviewText  : null) ||
    (typeof obj.reviewBody  === 'string' ? obj.reviewBody  : null) ||
    (typeof obj.body        === 'string' ? obj.body        : null) ||
    (typeof obj.text        === 'string' ? obj.text        : null) ||
    (typeof obj.description === 'string' ? obj.description : null);

  if (!text || text.trim().length < 10) return null;

  // Reviewer info may be nested under different keys
  const rev =
    (obj.reviewer     && typeof obj.reviewer     === 'object') ? obj.reviewer     :
    (obj.reviewerInfo && typeof obj.reviewerInfo === 'object') ? obj.reviewerInfo :
    obj;
  const name =
    rev.first_name || rev.firstName || rev.displayName || rev.name ||
    obj.reviewerName || obj.authorName || obj.guestName;

  if (!name) return null;

  const loc =
    (obj.reviewer     && obj.reviewer.location)     ||
    (obj.reviewerInfo && obj.reviewerInfo.location) ||
    obj.location || '';

  return {
    name:     String(name).trim(),
    text:     text.trim(),
    platform,
    location: loc,
    rating:   typeof (obj.rating ?? obj.overallRating ?? obj.starRating) === 'number'
      ? (obj.rating ?? obj.overallRating ?? obj.starRating) : 5,
  };
}

function findReviewsInJson(obj, platform, depth) {
  if (depth > 14 || obj === null || typeof obj !== 'object') return [];

  const asReview = tryParseReview(obj, platform);
  if (asReview) return [asReview];

  const results = [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...findReviewsInJson(item, platform, depth + 1));
    }
  } else {
    // Check likely keys first
    const priorityKeys = [
      'reviews', 'reviewsList', 'reviewComments', 'reviewDetails',
      'reviewInfo', 'reviewSummary', 'reviewHighlights',
      'sections', 'data', 'presentation', 'pdpReviews',
      'propertyInfo', 'listingInfo',
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

// ── Airbnb scraper ──────────────────────────────────────────────────────────

async function scrapeReviews(browser, url, platform) {
  const reviews = [];
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport:  { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Capture JSON from all XHR/fetch responses
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

  // Scroll the reviews modal to load all reviews
  const SCROLL_ATTEMPTS = 30;
  for (let i = 0; i < SCROLL_ATTEMPTS; i++) {
    const countBefore = reviews.length;

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

    if (reviews.length === countBefore && i > 2) {
      console.log(`  No new reviews after scroll ${i + 1} — stopping`);
      break;
    }
    if (reviews.length > countBefore) {
      console.log(`  Scroll ${i + 1}: total captured so far: ${reviews.length}`);
    }
  }

  // Fallback: extract from embedded page JSON
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

  // Deduplicate by name
  const seen = new Set();
  return reviews.filter((r) => {
    const key = r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── VRBO scraper ─────────────────────────────────────────────────────────────

async function scrapeVrbo(browser) {
  const reviews = [];
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport:  { width: 1440, height: 900 },
    locale:    'en-US',
    timezoneId:'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Sec-Fetch-Dest':  'document',
      'Sec-Fetch-Mode':  'navigate',
      'Sec-Fetch-Site':  'none',
      'Sec-Fetch-User':  '?1',
    },
  });

  const page = await context.newPage();

  // Capture JSON from all XHR/fetch responses
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) {
      await route.continue();
      return;
    }
    let response;
    try { response = await route.fetch(); } catch { await route.continue(); return; }
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json')) {
      try {
        const body = await response.text();
        const parsed = JSON.parse(body);
        const found = findReviewsInJson(parsed, 'VRBO', 0);
        if (found.length) {
          const pathname = (() => { try { return new URL(req.url()).pathname; } catch { return req.url(); } })();
          console.log(`  Captured ${found.length} VRBO review(s) from: ${pathname}`);
          reviews.push(...found);
        }
      } catch { /* ignore */ }
    }
    await route.fulfill({ response });
  });

  console.log(`  → ${VRBO_PAGE_URL}`);
  try {
    await page.goto(VRBO_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.warn(`  VRBO goto failed: ${e.message}`);
  }

  await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));

  const title = await page.title();
  console.log(`  Page loaded: "${title}" (${page.url()})`);

  if (/bot or not|access denied|captcha|challenge/i.test(title)) {
    console.warn('  Challenge page detected — waiting before continuing...');
    await page.waitForTimeout(10000);
  }

  // Try embedded page JSON first
  try {
    const nextData = await page.$eval('#__NEXT_DATA__', el => JSON.parse(el.textContent));
    const found = findReviewsInJson(nextData, 'VRBO', 0);
    if (found.length) {
      console.log(`  Found ${found.length} VRBO reviews in __NEXT_DATA__`);
      reviews.push(...found);
    }
  } catch { /* no __NEXT_DATA__ */ }

  // Open the reviews modal and scroll to load all reviews
  if (!reviews.length) {
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await page.evaluate((frac) => window.scrollTo(0, document.body.scrollHeight * frac), i / steps);
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(1500);

    // Try to click a "See all reviews" / "All reviews" button if present
    const seeAllClicked = await page.evaluate(() => {
      const patterns = [
        /see all \d+ reviews?/i,
        /all \d+ reviews?/i,
        /read all reviews?/i,
        /view all reviews?/i,
      ];
      const buttons = [...document.querySelectorAll('button, a')];
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (patterns.some(re => re.test(text))) {
          btn.click();
          return text;
        }
      }
      return null;
    });

    if (seeAllClicked) {
      console.log(`  Clicked: "${seeAllClicked}"`);
      await page.waitForTimeout(2000);
    } else {
      console.log(`  No "see all" button found — navigating to reviews dialog`);
      try {
        await page.goto(
          `https://www.vrbo.com/${VRBO_LISTING_ID}?dateless=true&pwaDialog=product-reviews`,
          { waitUntil: 'networkidle', timeout: 30000 }
        );
        await page.waitForTimeout(2000);
      } catch (e) {
        console.warn(`  VRBO dialog goto failed: ${e.message}`);
      }
    }

    for (let i = 0; i < 20; i++) {
      const countBefore = reviews.length;

      await page.evaluate(() => {
        const modalSels = [
          '[data-stid="reviews-modal"]',
          '[data-stid="modal-container"]',
          '[data-stid*="review"]',
          '[role="dialog"]',
          '[class*="modal"]',
          '[class*="Modal"]',
        ];
        let target = null;
        for (const sel of modalSels) {
          const el = document.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight) { target = el; break; }
        }
        if (target) {
          target.scrollTop = target.scrollHeight;
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
      });

      await page.waitForTimeout(1500);

      if (reviews.length === countBefore && i > 2) {
        console.log(`  No new VRBO reviews after scroll ${i + 1} — stopping`);
        break;
      }
      if (reviews.length > countBefore) {
        console.log(`  VRBO scroll ${i + 1}: total captured so far: ${reviews.length}`);
      }
    }

    if (!reviews.length) {
      console.log('  Trying DOM extraction from open modal...');
      try {
        const domReviews = await page.evaluate(() => {
          const results = [];
          const modalRoot =
            document.querySelector('[data-stid="reviews-user-generated-content-section"]') ||
            document.querySelector('[data-stid*="review"]') ||
            document.querySelector('[role="dialog"]') ||
            document.querySelector('[class*="modal" i]') ||
            document.body;

          const cards = [
            ...modalRoot.querySelectorAll('[data-stid="review-card"], [data-stid*="review-card"]'),
          ];
          const candidates = cards.length ? cards :
            [...modalRoot.querySelectorAll('li, article, [class*="ReviewCard" i], [class*="review-card" i]')];

          for (const el of candidates) {
            const bodyEl =
              el.querySelector('[data-stid="review-body"], [class*="review-body" i], [class*="reviewBody" i]') ||
              el.querySelector('p, blockquote');
            const text = (bodyEl?.textContent || '').trim();
            if (text.length < 15) continue;

            const nameEl =
              el.querySelector('[data-stid="review-author"], [class*="reviewer" i], [class*="author" i], h3, h4, strong');
            const rawName = (nameEl?.textContent || '').trim().split('\n')[0];
            if (!rawName || rawName.length > 60 || /^[\d★\s]+$/.test(rawName)) continue;

            let rating = 5;
            const ratingEl = el.querySelector('[aria-label*="out of" i], [aria-label*="star" i], [class*="rating" i]');
            if (ratingEl) {
              const m = (ratingEl.getAttribute('aria-label') || '').match(/(\d(?:\.\d+)?)/);
              if (m) rating = parseFloat(m[1]);
            }

            results.push({ name: rawName, text, platform: 'VRBO', location: '', rating });
          }
          return results;
        });

        if (domReviews.length) {
          console.log(`  Found ${domReviews.length} VRBO reviews via DOM`);
          reviews.push(...domReviews);
        } else {
          console.log('  DOM extraction found 0 reviews');
          // Dump modal HTML snippet for debugging
          const snippet = await page.evaluate(() => {
            const modal =
              document.querySelector('[role="dialog"]') ||
              document.querySelector('[class*="modal" i]');
            return modal ? modal.innerHTML.slice(0, 2000) : '(no modal found)';
          });
          console.log('  Modal HTML snippet:', snippet);
        }
      } catch (e) {
        console.warn(`  VRBO DOM fallback error: ${e.message}`);
      }
    }
  }

  await context.close();

  // Deduplicate by name
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
    vrboReviews = await scrapeVrbo(browser);
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
