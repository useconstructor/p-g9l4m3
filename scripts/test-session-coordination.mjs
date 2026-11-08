import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const loadDependency = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.platform !== 'darwin') throw new Error('This local regression requires macOS sandbox-exec outbound isolation. No app or database has started.');
const donor = process.env.SESSION_TEST_NODE_MODULES || path.join(root, 'node_modules');
const browserExecutable = process.env.SESSION_TEST_CHROMIUM;
if (!browserExecutable || !fs.existsSync(browserExecutable)) throw new Error('Set SESSION_TEST_CHROMIUM to an existing Chromium/headless-shell executable; this test never downloads browsers.');
const tempRoot = path.join(root, 'tmp-tests');
fs.mkdirSync(tempRoot, {
  recursive: true
});
const base = fs.mkdtempSync(path.join(tempRoot, 'session-coordination-'));
const app = path.join(base, 'scratch-app');
fs.mkdirSync(app);
const publicManifest = [];
const configurationFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs', 'components.json', 'branding.json'];
function copyPublic(relative) {
  const source = path.join(root, relative),
    target = path.join(app, relative);
  if (!fs.existsSync(source)) return;
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Public source symlink not allowed: ' + relative);
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, {
      recursive: true
    });
    for (const name of fs.readdirSync(source)) copyPublic(path.join(relative, name));
  } else {
    fs.mkdirSync(path.dirname(target), {
      recursive: true
    });
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(target, bytes);
    publicManifest.push({
      path: relative,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    });
  }
}
for (const relative of ['src', 'public', ...configurationFiles]) copyPublic(relative);
fs.symlinkSync(donor, path.join(app, 'node_modules'));
fs.writeFileSync(path.join(base, 'tested-public-source-manifest.json'), JSON.stringify({
  files: publicManifest,
  sourceRepository: root,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
}, null, 2) + '\n');
const {
    chromium
  } = loadDependency(donor + '/playwright'),
  {
    createClient
  } = loadDependency(donor + '/@libsql/client');
const origin = 'http://127.0.0.1:4099',
  dbFile = base + '/fictional.sqlite';
const hash = b => crypto.createHash('sha256').update(b).digest('hex'),
  fileHash = p => hash(fs.readFileSync(p));
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_ENV: 'production',
  APP_ORIGIN: origin,
  TURSO_DATABASE_URL: 'file:' + dbFile,
  TURSO_AUTH_TOKEN: 'fictional-local-only-not-a-credential'
});
const report = {
  correctedCandidateLocalOnly: true,
  canonical: false,
  readiness: false,
  appMatrixCredits: 0,
  origin,
  sourceChanges: [],
  requests: [],
  lockObservations: [],
  blockedExternal: [],
  pageErrors: [],
  checks: {},
  commands: [],
  cleanup: {},
  limitations: ['Controlled own-page navigator.locks absence; not native browser policy denial', 'Local HTTP Lax cookie; not HTTPS partitioning/iframe/Constructor/Turso verification', 'Missing-lock conditions are controlled only in owned pages, not native policy-denial cases']
};
const contexts = [],
  labels = new Map(),
  activeRoutes = new Set();
let server, browser;
const started = Date.now(),
  sleep = ms => new Promise(r => setTimeout(r, ms));
function command(args, log) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(base + '/' + log, 'w', 0o600),
      p = spawn('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network-outbound)', process.execPath, ...args], {
        cwd: app,
        env,
        stdio: ['ignore', fd, fd]
      });
    report.commands.push({
      args,
      pid: p.pid,
      networkOutboundDenied: true
    });
    p.once('error', reject);
    p.once('close', code => {
      fs.closeSync(fd);
      if (code === 0) resolve();
      else reject(new Error('Own command exited ' + code + ' inspect ' + log));
    });
  });
}
async function countRows() {
  const db = createClient({
    url: 'file:' + dbFile,
    authToken: env.TURSO_AUTH_TOKEN
  });
  try {
    const counts = {};
    for (const table of ['sessions', 'notes']) {
      const present = await db.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?", [table]);
      counts[table] = present.rows[0].count ? Number((await db.execute('SELECT COUNT(*) AS count FROM ' + table)).rows[0].count) : 0;
    }
    return counts;
  } finally {
    db.close();
  }
}
function remaining(deadline) {
  const ms = deadline - Date.now();
  assert(ms > 0, 'Existing scenario deadline exhausted');
  return ms;
}
async function ownContext() {
  const c = await browser.newContext({
    viewport: {
      width: 1280,
      height: 900
    },
    serviceWorkers: 'block'
  });
  contexts.push(c);
  await c.route('**/*', route => {
    const work = (async () => {
      const request = route.request(),
        u = new URL(request.url());
      if (u.origin !== origin) {
        report.blockedExternal.push({
          origin: u.origin,
          path: u.pathname
        });
        await route.abort('blockedbyclient');
        return;
      }
      if (['/api/session', '/api/resumen'].includes(u.pathname)) {
        let action;
        try {
          action = request.postDataJSON()?.action;
        } catch {}
        const frame = request.frame(),
          label = labels.get(frame.page()) || 'unknown';
        const native = await frame.evaluate(async () => ({
          locksAvailable: !!navigator.locks,
          held: navigator.locks ? (await navigator.locks.query()).held.map(x => ({
            name: x.name,
            mode: x.mode
          })) : []
        }));
        report.lockObservations.push({
          page: label,
          path: u.pathname,
          action,
          ...native
        });
      }
      await route.continue();
    })();
    activeRoutes.add(work);
    work.finally(() => activeRoutes.delete(work)).catch(() => {});
    return work;
  });
  return c;
}
async function pageFor(c, label, noLocks = false) {
  const p = await c.newPage();
  labels.set(p, label);
  if (noLocks) await p.addInitScript(() => Object.defineProperty(navigator, 'locks', {
    value: undefined,
    configurable: true
  }));
  p.on('pageerror', e => report.pageErrors.push({
    page: label,
    message: e.message
  }));
  p.on('response', r => {
    const q = r.request(),
      u = new URL(q.url());
    if (u.origin === origin && u.pathname.startsWith('/api/')) {
      let action;
      try {
        action = q.postDataJSON()?.action;
      } catch {}
      report.requests.push({
        page: label,
        method: q.method(),
        path: u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '{id}'),
        action,
        status: r.status()
      });
    }
  });
  return p;
}
async function ready(p, deadline) {
  await p.waitForFunction(() => document.querySelector('.summary-panel')?.getAttribute('aria-busy') === 'false' && document.querySelector('.summary-panel .stat strong')?.textContent !== '—', undefined, {
    timeout: remaining(deadline)
  });
}
async function read(p, url) {
  return p.evaluate(async url => {
    const r = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    return {
      status: r.status,
      body: await r.json()
    };
  }, url);
}
async function shot(p, name) {
  const dir = root + '/test/clone-images';
  fs.mkdirSync(dir, {
    recursive: true
  });
  await p.screenshot({
    path: dir + '/' + name,
    fullPage: true
  });
  report.screenshots ||= [];
  report.screenshots.push('test/clone-images/' + name);
}
(async () => {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(4099, '127.0.0.1', () => probe.close(resolve));
  });
  const db = createClient({
    url: 'file:' + dbFile,
    authToken: env.TURSO_AUTH_TOKEN
  });
  try {
    assert.equal((await db.execute('SELECT 1 AS value')).rows[0].value, 1);
  } finally {
    db.close();
  }
  if (!fs.existsSync(app + '/.next/BUILD_ID')) await command([donor + '/next/dist/bin/next', 'build', '--webpack'], 'build.log');else report.commands.push({
    command: 'reuse own successful unchanged corrected source build'
  });
  report.checks.buildPassed = true;
  const fd = fs.openSync(base + '/server.log', 'w', 0o600);
  server = spawn('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network-outbound)', process.execPath, donor + '/next/dist/bin/next', 'start', '-p', '4099', '-H', '127.0.0.1'], {
    cwd: app,
    env,
    stdio: ['ignore', fd, fd]
  });
  server.once('close', () => fs.closeSync(fd));
  report.commands.push({
    args: ['next', 'start', '-p', '4099', '-H', '127.0.0.1'],
    pid: server.pid,
    networkOutboundDenied: true
  });
  const startBound = Date.now() + 30000;
  while (true) {
    assert(server.exitCode === null, 'Own server exited');
    try {
      const r = await fetch(origin + '/api/info');
      if (r.status === 200) break;
    } catch {}
    remaining(startBound);
    await sleep(250);
  }
  const executable = "'" + browserExecutable.replaceAll("'", "'\\''") + "'",
    wrapper = base + '/isolated-chromium.sh';
  fs.writeFileSync(wrapper, "#!/bin/sh\nexec /usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network-outbound) (allow network-outbound (remote ip \"localhost:4099\"))' " + executable + " \"$@\"\n", {
    mode: 0o700
  });
  browser = await chromium.launch({
    executablePath: wrapper,
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--no-pings']
  });
  // A: fresh direct owner, controlled no locks; genuine clean retry must verify only.
  {
    const c = await ownContext(),
      p = await pageFor(c, 'clean-no-locks', true),
      deadline = Date.now() + 20000;
    await p.goto(origin + '/', {
      waitUntil: 'domcontentloaded'
    });
    const recovery = p.getByRole('region', {
      name: 'Recuperación de sesión',
      exact: true
    });
    await recovery.waitFor({
      state: 'visible',
      timeout: remaining(deadline)
    });
    assert.equal(report.requests.filter(x => x.page === 'clean-no-locks' && x.path === '/api/session').length, 0);
    assert.equal((await c.cookies(origin)).length, 0);
    const verify = p.waitForResponse(r => r.url() === origin + '/api/session' && r.request().postDataJSON()?.action === 'verify', {
      timeout: remaining(deadline)
    });
    await recovery.getByRole('button', {
      name: 'Reintentar',
      exact: true
    }).click();
    assert.equal((await verify).status(), 401);
    await p.waitForFunction(() => document.querySelector('.session-recovery p')?.textContent?.includes('Reintenta antes de empezar una sesión vacía.'), undefined, {
      timeout: remaining(deadline)
    });
    assert.deepEqual(report.requests.filter(x => x.page === 'clean-no-locks' && x.path === '/api/session').map(x => [x.action, x.status]), [['verify', 401]]);
    assert.deepEqual(await countRows(), {
      sessions: 0,
      notes: 0
    });
    assert.equal((await c.cookies(origin)).length, 0);
    assert.equal(await p.evaluate(() => localStorage.getItem('notas-de-bolsillo:sesion:direct')), null);
    report.checks.cleanNoLocks = {
      normalZeroPosts: true,
      retryVerify401: true,
      initializePosts: 0,
      sessionRows: 0,
      noteRows: 0,
      noCookieIssued: true,
      noMarkerWritten: true
    };
    await recovery.getByRole('button', {
      name: 'Empezar sesión vacía',
      exact: true
    }).click();
    const blockedDialog = p.getByRole('alertdialog', {
      name: '¿Empezar una sesión vacía?',
      exact: true
    });
    await blockedDialog.waitFor({
      state: 'visible',
      timeout: remaining(deadline)
    });
    await blockedDialog.getByRole('button', {
      name: 'Empezar sesión vacía',
      exact: true
    }).click();
    await p.waitForFunction(() => document.querySelector('.session-recovery p')?.textContent?.includes('Este navegador no permite coordinar una sesión nueva.'), undefined, {
      timeout: remaining(deadline)
    });
    assert.equal(report.requests.filter(x => x.page === 'clean-no-locks' && x.action === 'restart').length, 0);
    assert.deepEqual(await countRows(), {
      sessions: 0,
      notes: 0
    });
    assert.equal((await c.cookies(origin)).length, 0);
    report.checks.cleanNoLocks.confirmedResetBlockedWithSpanishRecovery = true;
    report.checks.cleanNoLocks.restartPosts = 0;
    await shot(p, 'session-clean-no-locks.png');
    await c.close();
    contexts.splice(contexts.indexOf(c), 1);
  }
  // B: three fresh genuine pages in one partition use real native Web Locks.
  const c = await ownContext(),
    pages = await Promise.all([1, 2, 3].map(i => pageFor(c, 'native-view-' + i)));
  const sharedDeadline = Date.now() + 20000;
  await Promise.all(pages.map(p => p.goto(origin + '/', {
    waitUntil: 'domcontentloaded'
  })));
  await Promise.all(pages.map(p => ready(p, sharedDeadline)));
  assert((await Promise.all(pages.map(p => p.evaluate(() => !!navigator.locks)))).every(Boolean));
  const initial = report.requests.filter(x => x.page.startsWith('native-view-') && x.path === '/api/session');
  assert.equal(initial.filter(x => x.action === 'initialize').length, 1);
  assert.equal(initial.filter(x => x.action === 'verify').length, 3);
  assert.equal(initial.filter(x => x.action === 'verify' && x.status === 401).length, 1);
  assert.equal(initial.filter(x => x.action === 'verify' && x.status === 200).length, 2);
  const summaries = await Promise.all(pages.map(p => read(p, '/api/resumen')));
  assert(summaries.every(x => x.status === 200 && x.body.total === 0));
  assert.equal(new Set(summaries.map(x => x.body.session_ref)).size, 1);
  const originalOwner = summaries[0].body.session_ref;
  assert.deepEqual(await countRows(), {
    sessions: 1,
    notes: 0
  });
  const nativePosts = report.lockObservations.filter(x => x.page.startsWith('native-view-') && x.path === '/api/session');
  assert(nativePosts.every(x => x.locksAvailable && x.held.some(l => l.name === 'notas-de-bolsillo:session' && l.mode === 'exclusive')));
  for (let i = 1; i <= 3; i++) assert(report.lockObservations.some(x => x.page === 'native-view-' + i && x.path === '/api/resumen' && x.held.some(l => l.name === 'notas-de-bolsillo:session')));
  report.checks.nativeThreeViews = {
    actualNativeLocks: true,
    samePartition: true,
    views: 3,
    verifyPosts: 3,
    initializePosts: 1,
    sameOwner: true,
    ownerHash: hash(originalOwner),
    sessionRows: 1,
    fullPostAndAuthenticatedProbeLockObserved: true
  };
  // C: establish genuine data via UI, then fresh no-lock page reuses cookie owner.
  const writer = pages[0],
    writeDeadline = Date.now() + 20000;
  await writer.getByRole('region', {
    name: 'Resumen de tus notas',
    exact: true
  }).getByRole('link', {
    name: 'Crear mi primera nota',
    exact: true
  }).click({timeout: remaining(writeDeadline)});
  const sheet = writer.getByRole('region', {
    name: 'Hoja de escritura',
    exact: true
  });
  await sheet.getByRole('textbox', {
    name: 'Título',
    exact: true
  }).fill('Fixture local de recuperación');
  await sheet.getByRole('textbox', {
    name: 'Texto (opcional)',
    exact: true
  }).fill('Dato ficticio conservado sin cambiar identidad.');
  const created = writer.waitForResponse(r => r.url() === origin + '/api/notas' && r.request().method() === 'POST', {
    timeout: remaining(writeDeadline)
  });
  await sheet.getByRole('button', {
    name: 'Guardar nota',
    exact: true
  }).click();
  assert.equal((await created).status(), 201);
  await writer.waitForFunction(() => document.querySelector('#note-form .save-status')?.textContent?.startsWith('Guardado'), undefined, {
    timeout: remaining(writeDeadline)
  });
  const before = await read(writer, '/api/notas');
  assert.equal(before.status, 200);
  assert.equal(before.body.total, 1);
  const note = before.body.notas[0];
  assert.equal(note.titulo, 'Fixture local de recuperación');
  const manual = await pageFor(c, 'valid-cookie-no-locks', true),
    manualDeadline = Date.now() + 20000;
  await manual.goto(origin + '/', {
    waitUntil: 'domcontentloaded'
  });
  const recovery = manual.getByRole('region', {
    name: 'Recuperación de sesión',
    exact: true
  });
  await recovery.waitFor({
    state: 'visible',
    timeout: remaining(manualDeadline)
  });
  const reused = manual.waitForResponse(r => r.url() === origin + '/api/session' && r.request().postDataJSON()?.action === 'verify', {
    timeout: remaining(manualDeadline)
  });
  await recovery.getByRole('button', {
    name: 'Reintentar',
    exact: true
  }).click();
  assert.equal((await reused).status(), 200);
  await ready(manual, manualDeadline);
  const current = await read(manual, '/api/resumen'),
    after = await read(manual, '/api/notas');
  assert.equal(current.status, 200);
  assert.equal(current.body.session_ref, originalOwner);
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.notas, before.body.notas);
  assert.deepEqual(report.requests.filter(x => x.page === 'valid-cookie-no-locks' && x.path === '/api/session').map(x => [x.action, x.status]), [['verify', 200]]);
  assert.deepEqual(await countRows(), {
    sessions: 1,
    notes: 1
  });
  report.checks.manualValidCookie = {
    verify200: true,
    initializePosts: 0,
    ownerPreserved: true,
    noteByteFieldsPreserved: true,
    noteRows: 1,
    sessionRows: 1
  };
  await shot(manual, 'session-valid-cookie-no-locks.png');
  // D: controlled cookie loss in own context, native locks reset remains confirmed.
  await manual.close();
  for (const p of pages.slice(1)) await p.close();
  await c.clearCookies();
  const reset = await pageFor(c, 'native-confirmed-reset'),
    resetDeadline = Date.now() + 20000;
  await reset.goto(origin + '/', {
    waitUntil: 'domcontentloaded'
  });
  const resetRecovery = reset.getByRole('region', {
    name: 'Recuperación de sesión',
    exact: true
  });
  await resetRecovery.waitFor({
    state: 'visible',
    timeout: remaining(resetDeadline)
  });
  assert.deepEqual(report.requests.filter(x => x.page === 'native-confirmed-reset' && x.path === '/api/session').map(x => [x.action, x.status]), [['verify', 401]]);
  await resetRecovery.getByRole('button', {
    name: 'Empezar sesión vacía',
    exact: true
  }).click();
  let dialog = reset.getByRole('alertdialog', {
    name: '¿Empezar una sesión vacía?',
    exact: true
  });
  await dialog.waitFor({
    state: 'visible',
    timeout: remaining(resetDeadline)
  });
  const cancel = await dialog.getByRole('button', {
    name: 'Cancelar',
    exact: true
  }).elementHandle();
  await reset.waitForFunction(el => el === document.activeElement, cancel, {
    timeout: remaining(resetDeadline)
  });
  assert(await dialog.getByRole('button', {
    name: 'Cancelar',
    exact: true
  }).evaluate(el => el === document.activeElement));
  await dialog.getByRole('button', {
    name: 'Cancelar',
    exact: true
  }).click();
  await dialog.waitFor({
    state: 'hidden',
    timeout: remaining(resetDeadline)
  });
  assert.equal(report.requests.filter(x => x.page === 'native-confirmed-reset' && x.action === 'restart').length, 0);
  await resetRecovery.getByRole('button', {
    name: 'Empezar sesión vacía',
    exact: true
  }).click();
  dialog = reset.getByRole('alertdialog', {
    name: '¿Empezar una sesión vacía?',
    exact: true
  });
  const restarted = reset.waitForResponse(r => r.url() === origin + '/api/session' && r.request().postDataJSON()?.action === 'restart', {
    timeout: remaining(resetDeadline)
  });
  await dialog.getByRole('button', {
    name: 'Empezar sesión vacía',
    exact: true
  }).click();
  assert.equal((await restarted).status(), 200);
  await ready(reset, resetDeadline);
  const empty = await read(reset, '/api/resumen');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.total, 0);
  assert.notEqual(empty.body.session_ref, originalOwner);
  assert.deepEqual(await countRows(), {
    sessions: 2,
    notes: 1
  });
  assert(report.lockObservations.some(x => x.page === 'native-confirmed-reset' && x.action === 'restart' && x.held.some(l => l.name === 'notas-de-bolsillo:session')));
  assert(report.lockObservations.some(x => x.page === 'native-confirmed-reset' && x.path === '/api/resumen' && x.held.some(l => l.name === 'notas-de-bolsillo:session')));
  report.checks.confirmedResetNativeLocks = {
    controlledOwnCookieLoss: true,
    automaticReplacementInitializePosts: 0,
    cancelSentNoRestart: true,
    initialFocusCancel: true,
    confirmedRestart200: true,
    postAndProbeNativeLockObserved: true,
    newOwner: true,
    newOwnerZeroNotes: true,
    priorNoteRetainedInDb: true,
    sessionRows: 2,
    noteRows: 1,
    noLocksResetSeparatelyBlocked: true
  };
  await shot(reset, 'session-native-confirmed-reset.png');
  report.passedLocalRegressions = 4;
})().catch(e => {
  report.failure = e.message;
  process.exitCode = 1;
}).finally(async () => {
  await Promise.allSettled([...activeRoutes]);
  for (const c of contexts) await c.close();
  report.cleanup.ownContextsClosed = true;
  if (browser) {
    await browser.close();
    report.cleanup.ownBrowserClosed = true;
  }
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    let timer;
    await Promise.race([new Promise(r => server.once('close', r)), new Promise(r => {
      timer = setTimeout(r, 5000);
    })]);
    clearTimeout(timer);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
      await new Promise(r => server.once('close', r));
    }
    report.cleanup.ownServerStopped = true;
  }
  report.cleanup.finalFictionalCounts = await countRows();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = dbFile + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  report.cleanup.ownDbFilesDeleted = true;
  const m = JSON.parse(fs.readFileSync(base + '/tested-public-source-manifest.json'));
  const changes = m.files.filter(f => fileHash(app + '/' + f.path) !== f.sha256);
  report.publicSourceFilesCompared = m.files.length;
  report.exactChanges = changes.map(f => ({
    path: f.path,
    before: f.sha256,
    after: fileHash(app + '/' + f.path)
  }));
  if (report.exactChanges.length !== 0) {
    report.failure = 'Unexpected public source changes';
    process.exitCode = 1;
  }
  report.durationMs = Date.now() - started;
  fs.writeFileSync(base + '/regression-results.json', JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600
  });
  console.log('Local evidence: ' + base);
  console.log(JSON.stringify({
    failure: report.failure || null,
    checks: report.checks,
    passedLocalRegressions: report.passedLocalRegressions,
    cleanup: report.cleanup,
    exactChanges: report.exactChanges,
    durationMs: report.durationMs
  }, null, 2));
});
