// End-to-end walk through the main features at phone size, checking each step for sideways overflow and errors.
//
//   node scripts/mobile-walkthrough.mjs        (same env vars as mobile-check.mjs; SIZE defaults to 390x844)
//
// Uses the real backend, so the AI steps (chat answer, quiz/exam generation, marking) need a working Groq key.
// Steps that depend on the AI are reported as "skipped" (not failed) when the AI service is unavailable.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.MINDAI_URL || 'http://localhost:5173';
const API = process.env.MINDAI_API || 'http://localhost:8000';
const EMAIL = process.env.MINDAI_EMAIL;
const PASSWORD = process.env.MINDAI_PASSWORD;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(process.env.OUT_DIR || 'mobile-walkthrough-shots');
const [W, H] = (process.env.SIZE || '390x844').split('x').map(Number);
if (!EMAIL || !PASSWORD) { console.error('Set MINDAI_EMAIL and MINDAI_PASSWORD.'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let page;
const pageErrors = [];

const overflow = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrollWidth ${document.documentElement.scrollWidth}`);
  const clipped = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) {
        const r = p.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return true;
      }
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"], .mesh-blob, .mesh-bg, .curtain, svg, canvas, .cy-container')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (r.right > vw + 2 || r.left < -2) && !clipped(el)) {
      out.push(`<${el.tagName.toLowerCase()}> "${(el.innerText || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
      if (out.length > 4) break;
    }
  }
  return out;
});

/** Run one step: ok / FAIL / skipped, with a screenshot and an overflow check afterwards. */
const step = async (name, fn) => {
  const started = Date.now();
  let status = 'ok', note = '';
  try {
    const r = await fn();
    if (r && r.skip) { status = 'skipped'; note = r.skip; }
    else if (r && r.note) note = r.note;
  } catch (e) {
    status = 'FAIL';
    note = e.message.split('\n')[0];
  }
  await sleep(500);
  const problems = await overflow().catch(() => []);
  if (problems.length && status === 'ok') { status = 'FAIL'; note = `overflow: ${problems.join(' | ')}`; }
  const errs = pageErrors.splice(0);
  if (errs.length && status === 'ok') { status = 'FAIL'; note = `page error: ${errs.join(' | ')}`; }
  await page.screenshot({ path: path.join(OUT, `${String(results.length + 1).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`) }).catch(() => {});
  results.push({ name, status, note, secs: Math.round((Date.now() - started) / 1000) });
  console.log(`${status.padEnd(7)} ${name}${note ? ' - ' + note : ''}`);
};

const clickText = (re, scope = 'button') => page.evaluate((src, sel) => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll(sel)].find(x => rx.test(x.textContent.replace(/\s+/g, ' ').trim()) && !x.disabled && x.offsetParent !== null);
  b?.click();
  return !!b;
}, re.source, scope);
const waitText = (re, timeout = 20000) => page.waitForFunction(src => new RegExp(src).test(document.body.innerText), { timeout }, re.source);
const nav = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('nav button')].find(x => x.textContent.replace(/[\s\u00a0]+/g, ' ').trim() === l);
  b?.click();
  return !!b;
}, label);
const goTo = async label => { if (!(await nav(label))) throw new Error(`no "${label}" in the menu`); await sleep(2200); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const login = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
  if (!login.token) { console.error('Login failed'); process.exit(2); }
  const auth = { Authorization: `Bearer ${login.token}` };
  // Remove documents left by earlier runs (the newest document becomes the default selection everywhere)
  const cleanup = async () => {
    const all = await (await fetch(`${API}/api/documents`, { headers: auth })).json();
    for (const d of all.filter(x => x.title === 'walkthrough-notes.md')) {
      await fetch(`${API}/api/documents/${d.id}`, { method: 'DELETE', headers: auth });
    }
  };
  await cleanup();

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT }).catch(() => {});
  await page.evaluateOnNewDocument(t => { localStorage.setItem('mindai.token', t); sessionStorage.setItem('mindai.splashSeen', '1'); }, login.token);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('nav[aria-label="Main"]');
  await sleep(1500);

  await step('Session restored after reload', async () => {
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('nav[aria-label="Main"]', { timeout: 15000 });
  });

  await step('AI Chat: ask Leo (streamed answer with sources)', async () => {
    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] button')].find(b => b.textContent.trim() === 'Chat')?.click());
    await sleep(2500);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.hasAttribute('aria-pressed') && b.textContent.includes('Leo'))?.click());
    await page.tap('textarea[aria-label="Message"]');
    await page.keyboard.type('In one sentence, what is a cell?');
    await page.evaluate(() => document.querySelector('form button[type="submit"]')?.click());
    try {
      await page.waitForFunction(() => /Skeptic/.test(document.body.innerText) && !document.querySelector('.streaming-cursor'), { timeout: 90000 });
    } catch {
      const text = await page.evaluate(() => document.body.innerText);
      if (/allowance|rate limit|AI service|try again/i.test(text)) return { skip: 'AI service unavailable' };
      throw new Error('no answer within 90 s');
    }
    const err = await page.evaluate(() => document.body.innerText.match(/(daily|allowance|couldn't|failed)[^\n]*/i)?.[0]);
    if (err) return { skip: `AI: ${err}` };
  });

  await step('Quiz: open a saved quiz and play it', async () => {
    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] button')].find(b => b.textContent.trim() === 'Quiz')?.click());
    await sleep(2500);
    if (!(await clickText(/^Open/))) return { skip: 'no saved quiz for this account' };
    await sleep(2500);
    await clickText(/^Start|^Play|^Practice/);
    await sleep(2500);
    const started = await page.evaluate(() => !!document.querySelector('[aria-label="Leave quiz"]'));
    if (!started) {
      // Pick the first mode card, then start
      await page.evaluate(() => document.querySelector('main button[aria-pressed]')?.click());
      await clickText(/Start/);
      await sleep(2500);
    }
    if (!(await page.evaluate(() => !!document.querySelector('[aria-label="Leave quiz"]')))) throw new Error('quiz player did not open');
    await page.evaluate(() => document.querySelector('main ol button, main .space-y-2\\.5 button, main button[class*="rounded-2xl"][class*="border-2"]')?.click());
    await sleep(800);
  });

  await step('Back button inside the quiz asks before leaving', async () => {
    if (!(await page.evaluate(() => !!document.querySelector('[aria-label="Leave quiz"]')))) return { skip: 'quiz player not open' };
    let asked = false;
    const handler = d => { asked = /Leave this quiz/.test(d.message()); };
    page.once('dialog', handler);
    await page.keyboard.press('Escape');
    await sleep(800);
    if (!asked) throw new Error('no confirmation when leaving with back/Escape');
  });

  await step('Export menu opens as a sheet and downloads a file', async () => {
    // After leaving the player the quiz screen is still open; otherwise open a saved quiz
    if (!(await clickText(/^Export/))) {
      await goTo('Quiz Generator');
      if (!(await clickText(/^Open/))) return { skip: 'no saved quiz' };
      await sleep(2500);
      if (!(await clickText(/^Export/))) throw new Error('no Export button');
    }
    await sleep(700);
    const inside = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Export"] button')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
    if (!inside) throw new Error('export options off screen');
    const before = new Set(fs.readdirSync(OUT));
    await clickText(/^CSV spreadsheet/);
    await sleep(3000);
    const added = fs.readdirSync(OUT).filter(f => !before.has(f) && !f.endsWith('.png'));
    if (!added.length) throw new Error('no file downloaded');
    return { note: `downloaded ${added.join(', ')}` };
  });

  await step('Exam paper: readable on a phone', async () => {
    await page.keyboard.press('Escape');
    await goTo('Exam Paper');
    if (!(await clickText(/^Open/))) {
      // The saved exam may belong to another document: open it from the dashboard's recent sets
      await goTo('Dashboard');
      if (!(await clickText(/Examination|Exam/, 'main button'))) return { skip: 'no saved exam' };
    }
    await sleep(3000);
    if (!(await page.evaluate(() => !!document.querySelector('.print-content')))) return { skip: 'exam paper did not open' };
    const narrowest = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('.print-content p')].filter(p => p.textContent.length > 30);
      return ps.length ? Math.min(...ps.map(p => p.getBoundingClientRect().width)) : null;
    });
    if (narrowest !== null && narrowest < 200) throw new Error(`question text only ${Math.round(narrowest)}px wide`);
    return { note: narrowest ? `narrowest question text ${Math.round(narrowest)}px` : '' };
  });

  await step('Study room: long link wraps, tap shows message actions', async () => {
    await goTo('Study Rooms');
    const opened = await page.evaluate(() => { const c = [...document.querySelectorAll('main button')].find(b => /members?|online/i.test(b.textContent)); c?.click(); return !!c; });
    if (!opened) return { skip: 'no room for this account' };
    await sleep(3000);
    await page.tap('textarea[aria-label="Message"]');
    await page.keyboard.type('Read https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all/to/test/wrapping');
    await page.evaluate(() => document.querySelector('form button[type="submit"]')?.click());
    await sleep(2500);
    const bubble = await page.evaluate(() => {
      const p = [...document.querySelectorAll('main p')].reverse().find(x => x.textContent.includes('example.com/a/very/long'));
      if (!p) return null;
      const r = p.getBoundingClientRect();
      p.parentElement.click();
      return r.right <= window.innerWidth + 1;
    });
    if (bubble === null) throw new Error('message did not appear (socket?)');
    if (!bubble) throw new Error('long link pushes the bubble off screen');
    await sleep(600);
    const actions = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Copy message"]')].some(b => getComputedStyle(b.parentElement).opacity === '1'));
    if (!actions) throw new Error('tapping a message does not show its actions');
  });

  await step('Reader: selecting text shows the actions', async () => {
    await page.keyboard.press('Escape'); // leave the room
    await goTo('Reader');
    await sleep(1500);
    const shown = await page.evaluate(async () => {
      const p = [...document.querySelectorAll('article p')].find(x => x.textContent.trim().length > 20);
      if (!p) return 'no text';
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, Math.min(25, p.firstChild.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      await new Promise(r => setTimeout(r, 900));
      const bar = document.querySelector('[role="toolbar"][aria-label="Selection actions"]');
      if (!bar) return 'no toolbar';
      const r = bar.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth ? 'ok' : 'toolbar off screen';
    });
    if (shown === 'no text') return { skip: 'no readable document' };
    if (shown !== 'ok') throw new Error(shown);
  });

  await step('Keyboard: a focused field stays visible', async () => {
    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] button')].find(b => b.textContent.trim() === 'Chat')?.click());
    await sleep(2500);
    await page.tap('textarea[aria-label="Message"]');
    await page.setViewport({ width: W, height: H - 320, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await sleep(900);
    const visible = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (!visible) throw new Error('the message box is hidden behind the keyboard area');
  });

  await step('Documents: upload shows progress on screen', async () => {
    await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await goTo('Documents');
    const input = await page.$('input[type=file]#file-upload');
    const file = path.join(OUT, 'walkthrough-notes.md');
    fs.writeFileSync(file, '# Walkthrough notes\n\nThe mitochondria is the powerhouse of the cell. Ribosomes build proteins.\n');
    await input.uploadFile(file);
    await sleep(900);
    const card = await page.evaluate(() => {
      const el = [...document.querySelectorAll('p')].find(p => /Processing Content/i.test(p.textContent));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    if (card === false) throw new Error('upload progress card is off screen');
    await page.waitForFunction(() => ![...document.querySelectorAll('p')].some(p => /Processing Content/i.test(p.textContent)), { timeout: 60000 });
    return { note: card === null ? 'upload finished before it could be seen' : 'progress card was visible' };
  });

  await browser.close();
  await cleanup();
  const failed = results.filter(r => r.status === 'FAIL');
  fs.writeFileSync(path.join(OUT, 'walkthrough.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length} steps: ${results.filter(r => r.status === 'ok').length} ok, ${failed.length} failed, ${results.filter(r => r.status === 'skipped').length} skipped`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('Walkthrough crashed:', e); process.exit(2); });
