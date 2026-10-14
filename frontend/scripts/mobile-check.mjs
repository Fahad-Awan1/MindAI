// Mobile layout check: opens every screen of MindAI at phone and tablet sizes, saves a screenshot of each,
// and FAILS (exit code 1) when a page scrolls sideways, something sticks out past the screen edge,
// or the page throws an error.
//
//   npm run check:mobile
//
// Needs a running frontend + backend and a test account (a verified one, so no email code is needed):
//   MINDAI_URL      frontend address         (default http://localhost:5173)
//   MINDAI_API      backend address          (default http://localhost:8000)
//   MINDAI_EMAIL    test account email       (required)
//   MINDAI_PASSWORD test account password    (required)
//   CHROME_PATH     Chrome/Edge executable   (default: the usual Windows Chrome path)
//   OUT_DIR         where screenshots go     (default ./mobile-check-shots)
//   SIZES           e.g. "360x740,390x844"   (default: 360x740, 390x844, 430x932, 768x1024)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.MINDAI_URL || 'http://localhost:5173';
const API = process.env.MINDAI_API || 'http://localhost:8000';
const EMAIL = process.env.MINDAI_EMAIL;
const PASSWORD = process.env.MINDAI_PASSWORD;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(process.env.OUT_DIR || 'mobile-check-shots');
const SIZES = (process.env.SIZES || '360x740,390x844,430x932,768x1024')
  .split(',').map(s => s.trim().split('x').map(Number)).map(([width, height]) => ({ width, height }));

if (!EMAIL || !PASSWORD) {
  console.error('Set MINDAI_EMAIL and MINDAI_PASSWORD (a verified test account).');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Sideways overflow: the page itself, and any visible element sticking out past the right/left edge without a clipping parent. */
const measureOverflow = page => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const problems = [];
  const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (docWidth > vw + 1) problems.push(`document scrollWidth ${docWidth} > viewport ${vw}`);
  const clipped = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) {
        const r = p.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return true;
      }
    }
    return false;
  };
  const describe = el => {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 6).join('.') : '';
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}>${text ? ` "${text}"` : ''}`;
  };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"], .mesh-blob, .mesh-bg, .curtain, svg, canvas, .cy-container')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 2 || r.left < -2) && !clipped(el)) {
      // Report the outermost offender only
      if ([...seen].some(p => p.contains(el))) continue;
      seen.add(el);
      problems.push(`${describe(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})`);
    }
  }
  return problems.slice(0, 8);
});

const clickNav = (page, label) => page.evaluate(l => {
  const b = [...document.querySelectorAll('nav button')].find(x => x.textContent.replace(/[\s\u00a0]+/g, ' ').trim() === l);
  b?.click();
  return !!b;
}, label);

const clickButton = (page, re) => page.evaluate(src => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll('main button, [role="dialog"] button')].find(x => rx.test(x.textContent.trim()) && !x.disabled);
  b?.click();
  return !!b;
}, re.source);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const { token } = await login.json();
  if (!token) { console.error('Login failed for the test account (is it verified?)'); process.exit(2); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const failures = [];
  let checked = 0;

  for (const size of SIZES) {
    const tag = `${size.width}x${size.height}`;
    const mobile = size.width < 768;
    const viewport = { ...size, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 };
    const record = async (page, name, errors) => {
      await sleep(400);
      const problems = await measureOverflow(page);
      const pageErrors = errors.splice(0);
      await page.screenshot({ path: path.join(OUT, `${tag}_${slug(name)}.png`) });
      checked++;
      if (problems.length || pageErrors.length) failures.push({ size: tag, screen: name, problems, errors: pageErrors });
      console.log(`${problems.length || pageErrors.length ? 'FAIL' : 'ok  '} ${tag} ${name}${problems.length ? ' - ' + problems.join(' | ') : ''}${pageErrors.length ? ' - errors: ' + pageErrors.join(' | ') : ''}`);
    };

    // Signed-out screens
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport(viewport);
      await page.evaluateOnNewDocument(() => { sessionStorage.setItem('mindai.splashSeen', '1'); localStorage.removeItem('mindai.token'); });
      await page.goto(URL, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#auth-email');
      await sleep(1200);
      await record(page, 'Sign in', errors);
      await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')][1]?.click());
      await sleep(900);
      await page.type('#auth-password', 'abc');
      await record(page, 'Create account', errors);
      await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')][0]?.click());
      await sleep(700);
      await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Forgot password?')?.click());
      await sleep(1000);
      await record(page, 'Forgot password', errors);
      await page.close();
    }

    // Signed-in screens
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.dismiss());
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument(t => { localStorage.setItem('mindai.token', t); sessionStorage.setItem('mindai.splashSeen', '1'); }, token);
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('nav');
    await sleep(1800);
    const labels = await page.evaluate(() => [...document.querySelectorAll('nav button')]
      .map(b => b.textContent.replace(/[\s\u00a0]+/g, ' ').trim())
      .filter(t => t.length > 2 && t.length < 30 && !/^(Overview|Learn together|Study tools|See & hear|MindAI|Install app|Home|Chat|Quiz|Exam|About)$/.test(t)));
    for (const label of [...new Set(labels)]) {
      if (!(await clickNav(page, label))) continue;
      await sleep(2200);
      await record(page, label, errors);
      // A level deeper on the main tools: open the first saved quiz / exam / room
      if (label === 'Quiz Generator' && await clickButton(page, /^Open/)) { await sleep(2200); await record(page, 'Quiz - saved set', errors);
        if (await clickButton(page, /^Export/)) { await sleep(700); await record(page, 'Quiz - export menu', errors); await page.keyboard.press('Escape'); await sleep(300); } }
      if (label === 'Exam Paper' && await clickButton(page, /^Open/)) { await sleep(2200); await record(page, 'Exam - saved paper', errors); }
      if (label === 'Study Rooms') {
        const opened = await page.evaluate(() => { const c = [...document.querySelectorAll('main button')].find(b => /members?|online/i.test(b.textContent)); c?.click(); return !!c; });
        if (opened) { await sleep(2200); await record(page, 'Study room', errors); }
      }
    }
    if (mobile) {
      await page.evaluate(() => document.querySelector('header button, .md\\:hidden button')?.click());
      await sleep(800);
      await record(page, 'Menu drawer', errors);
    }
    await page.close();
  }

  await browser.close();
  console.log(`\n${checked} screens checked, ${failures.length} with problems. Screenshots: ${OUT}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checked, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('Check crashed:', e); process.exit(2); });
