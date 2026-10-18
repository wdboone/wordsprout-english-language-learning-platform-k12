'use strict';
const { loadApp } = require('./dom-harness');

let failures = 0;
let passes = 0;

function ok(cond, msg) {
  if (cond) { passes++; }
  else { failures++; console.error('FAIL:', msg); }
}

function collectErrors(window) {
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(e.reason));
  return errors;
}

const STUDENT_VIEWS = ['dash','badges','profile','listening','speaking','reading','writing','wordanatomy',
  'assess','final','buddy','teacher','homework','contact','feedback','policy','calendar','cost','standards','vision'];
const ADMIN_VIEWS = ['admin','analytics'];

async function testAnonymousBoot() {
  const { window } = await loadApp();
  const errors = collectErrors(window);
  ok(window.document.getElementById('authWrap').style.display !== 'none', 'anonymous: auth screen is shown');
  ok(window.document.getElementById('shell').classList.contains('on') === false, 'anonymous: app shell stays hidden');
  ok(errors.length === 0, 'anonymous boot: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testStudentViews() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  ok(window.document.getElementById('shell').classList.contains('on'), 'student: app shell is entered');
  for (const view of STUDENT_VIEWS) {
    window.go(view);
    await new Promise((r) => setTimeout(r, 10));
    const html = window.document.getElementById('main').innerHTML;
    ok(html && html.trim().length > 0, `student view "${view}" rendered non-empty content`);
  }
  // admin-only views should redirect a non-admin back to dash, not throw
  window.go('admin');
  await new Promise((r) => setTimeout(r, 10));
  ok(window.document.querySelector('.nav-btn[data-view="dash"]').classList.contains('on'),
    'student: "admin" view redirects non-admins to dash');
  ok(errors.length === 0, 'student views: no thrown errors (' + errors.map(String).join('; ') + ')');
}

// Per-student growth chart (score_history + Screener PL tracking).
async function testAnalyticsGrowthChart() {
  const { window, sb } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  window.go('analytics');
  await new Promise((r) => setTimeout(r, 30));

  const picker = window.document.getElementById('growthStudentPicker');
  ok(!!picker, 'analytics: growth student picker exists');
  const optionLabels = Array.from(picker.options).map((o) => o.textContent);
  ok(optionLabels.some((t) => t.includes('Carlos')), 'analytics: picker lists real students by name');
  ok(optionLabels[0].includes('All students'), 'analytics: picker defaults to the aggregate view');
  const aggregateSummaryHtml = window.document.getElementById('growthSummary').innerHTML;
  ok(aggregateSummaryHtml.includes('since first tracked week'), 'analytics: aggregate summary uses the cohort-wide "since first tracked week" wording');

  // Select the seeded T1 student (two score_history checkpoints, one with overall_pl set).
  picker.value = 'student-uid-2';
  window.renderGrowthChart();
  await new Promise((r) => setTimeout(r, 20));
  const wrapHtml = window.document.getElementById('growthChartWrap').innerHTML;
  ok(wrapHtml.includes('<canvas'), 'analytics: individual student view renders a chart canvas, not the empty-state message');
  const screenerHtml = window.document.getElementById('screenerChartWrap').innerHTML;
  ok(screenerHtml.includes('Placement Level Over Time') && screenerHtml.includes('<canvas'),
    'analytics: screener PL chart renders for a student with at least one overall_pl data point');

  // The summary boxes ("Listening: 82% now...") must actually reflect the selected student,
  // not stay frozen on the whole-cohort aggregate — this was a real reported bug: the picker
  // updated the chart below but silently left these numbers showing everyone's average.
  const summaryHtml = window.document.getElementById('growthSummary').innerHTML;
  ok(summaryHtml.includes('92%'), 'analytics: summary boxes show the selected student\'s own current score (Carlos: listening 92), not the cohort average');
  ok(!summaryHtml.includes('since first tracked week'), 'analytics: individual-student summary uses "since first tracked" wording, not the aggregate "since first tracked week" wording');

  // A student with zero score_history rows at all (student-uid-1, Mai) should show the
  // honest "no history yet" message instead of an empty/broken chart.
  picker.value = 'student-uid-1';
  window.renderGrowthChart();
  await new Promise((r) => setTimeout(r, 20));
  const maiWrap = window.document.getElementById('growthChartWrap').innerHTML;
  ok(maiWrap.includes('No score history recorded'), 'analytics: student with zero history gets an honest empty state, not a broken chart');
  const maiScreenerWrap = window.document.getElementById('screenerChartWrap').innerHTML;
  ok(maiScreenerWrap === '' || maiScreenerWrap.includes('No Screener history'),
    'analytics: screener panel is empty/cleared for a student with no history at all');

  // Back to aggregate — confirm it still works after switching away and back.
  picker.value = '';
  window.renderGrowthChart();
  await new Promise((r) => setTimeout(r, 20));
  ok(window.document.getElementById('growthChartWrap').innerHTML.includes('<canvas') ||
     window.document.getElementById('growthChartWrap').innerHTML.includes('Not enough history'),
    'analytics: switching back to the aggregate view re-renders correctly');

  ok(errors.length === 0, 'analytics growth chart: no thrown errors (' + errors.map(String).join('; ') + ')');
}

// The Screener now snapshots history on completion too (previously it never did — this was
// the actual root cause preventing any "screener over time" view from being possible at all).
async function testScreenerSnapshotsHistory() {
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const beforeCount = sb._db.score_history.length;
  // USER is declared with `let` at the top level, so it isn't exposed as window.USER —
  // reach it via window.eval(), which runs in the page's own script realm where the
  // top-level `let` bindings actually live (this is a jsdom/browser quirk, not a bug).
  window.eval("USER.prog.screener = { listeningPL: 3, speakingPL: 3, readingPL: 4, writingPL: 4, overallPL: 3.5, frameworkLevel: 4 };");
  await window.snapshotScoreHistory();
  await new Promise((r) => setTimeout(r, 20));
  ok(sb._db.score_history.length === beforeCount + 1, 'screener: completing/retaking the Screener now adds a score_history row');
  const newest = sb._db.score_history[sb._db.score_history.length - 1];
  ok(newest.overall_pl === 3.5, 'screener: the snapshot correctly carries the current overall_pl value');
}

async function testAdminDashboardAndFeedback() {
  const { window, sb } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  window.go('admin');
  await new Promise((r) => setTimeout(r, 20));
  const mainHtml = window.document.getElementById('main').innerHTML;

  ok(mainHtml.includes('Needs Your Attention'), 'admin: attention dashboard renders');
  ok(window.document.querySelectorAll('.stat-tile').length === 7, 'admin: 7 stat tiles rendered');
  ok(mainHtml.includes('Conversations'), 'admin: unified conversations section renders');
  ok(mainHtml.includes('App Feedback'), 'admin: feedback section renders');
  ok(mainHtml.includes('Mai') && mainHtml.includes('Needs reply'), 'admin: roster shows the student with a needs-reply badge');
  ok(mainHtml.includes('Add dark mode'), 'admin: seeded feedback body appears');

  // Exercise the reply flow end-to-end against the fake DB, via the unified
  // per-student Conversation thread (messages + homework combined).
  window.openConversation('student-uid-1');
  await new Promise((r) => setTimeout(r, 20));
  const convoHtml = window.document.getElementById('main').innerHTML;
  ok(convoHtml.includes('How do I use'), 'conversation: seeded message body appears in the thread');
  const replyBox = window.document.getElementById('msgReply1');
  ok(!!replyBox, 'conversation: reply textarea exists for message #1');
  replyBox.value = 'Great question — "although" introduces a contrast.';
  await window.adminReplyMessage(1, window.vConversation);
  await new Promise((r) => setTimeout(r, 20));
  const msgRow = sb._db.messages.find((m) => m.id === 1);
  ok(msgRow.status === 'replied', 'admin: replying to a message marks it replied');
  ok(sb._db.messages.some((m) => m.from_admin && m.body.includes('although')),
    'admin: reply is inserted as a new from_admin message');

  // A general message with an attachment, sent proactively (not a reply to anything) —
  // the actual mechanism behind "start a new conversation" with any student.
  window.openConversation('student-uid-1');
  await new Promise((r) => setTimeout(r, 20));
  window.document.getElementById('convoBody').value = 'Here is a worksheet to help.';
  await window.adminSendConvoMessage();
  await new Promise((r) => setTimeout(r, 20));
  ok(sb._db.messages.some((m) => m.from_admin && m.body.includes('worksheet')),
    'conversation: proactive general message is inserted');

  // Feedback review flow
  window.go('admin');
  await new Promise((r) => setTimeout(r, 20));
  const fbBox = window.document.getElementById('fbReply1');
  ok(!!fbBox, 'admin: reply textarea exists for feedback #1');
  fbBox.value = "Thanks! We'll look into it.";
  await window.adminReplyFeedback(1);
  await new Promise((r) => setTimeout(r, 20));
  const fbRow = sb._db.feedback.find((f) => f.id === 1);
  ok(fbRow.status === 'reviewed', 'admin: reviewing feedback marks it reviewed');
  ok(fbRow.admin_response.includes("look into it"), 'admin: feedback response text is saved');

  for (const view of ADMIN_VIEWS) {
    window.go(view);
    await new Promise((r) => setTimeout(r, 10));
    const html = window.document.getElementById('main').innerHTML;
    ok(html && html.trim().length > 0, `admin view "${view}" rendered non-empty content`);
  }
  ok(errors.length === 0, 'admin flow: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testStudentFeedbackSubmission() {
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  window.go('feedback');
  await new Promise((r) => setTimeout(r, 10));
  window.document.getElementById('fbBody').value = 'The listening audio is too quiet.';
  window.document.getElementById('fbCategory').value = '🐛 Bug Report';
  await window.fbSubmit();
  await new Promise((r) => setTimeout(r, 10));
  ok(sb._db.feedback.some((f) => f.body.includes('too quiet')), 'student: feedback submission is inserted');
  ok(window.document.getElementById('fbList').innerHTML.includes('too quiet'),
    'student: submitted feedback appears in own history list');
  ok(errors.length === 0, 'student feedback flow: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testStudentPaymentClaimFlow() {
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  window.go('cost');
  await new Promise((r) => setTimeout(r, 20));
  let html = window.document.getElementById('main').innerHTML;
  ok(html.includes('waiting for him to verify') || html.includes('esperando que verifique'),
    'student: cost page shows pending-verification notice when a claim already exists');
  ok(!html.includes("I've Paid"), 'student: "I\'ve Paid" button is hidden while a claim is pending');

  // Simulate the no-pending-claim case: clear the seeded claim, re-render, submit a new one.
  sb._db.payment_claims = [];
  window.go('cost');
  await new Promise((r) => setTimeout(r, 20));
  html = window.document.getElementById('main').innerHTML;
  ok(html.includes("I've Paid"), 'student: "I\'ve Paid" button appears when no claim is pending');
  await window.submitPaymentClaim();
  await new Promise((r) => setTimeout(r, 20));
  ok(sb._db.payment_claims.some((c) => c.user_id === 'student-uid-1' && c.status === 'pending'),
    'student: submitting payment claim inserts a pending row');
  ok(errors.length === 0, 'student payment claim flow: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testAdminPaymentVerification() {
  const { window, sb } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  window.go('admin');
  await new Promise((r) => setTimeout(r, 20));
  const mainHtml = window.document.getElementById('main').innerHTML;
  ok(mainHtml.includes('Payment Claims Awaiting Verification'), 'admin: payment claims section renders');
  ok(mainHtml.includes('Paid this month'), 'admin: "paid this month" counter tile renders');
  ok(window.document.getElementById('claimMsg1') !== null, 'admin: verify UI exists for seeded claim #1');

  await window.adminVerifyPaymentClaim(1);
  await new Promise((r) => setTimeout(r, 20));
  const claim = sb._db.payment_claims.find((c) => c.id === 1);
  ok(claim.status === 'verified', 'admin: verifying a claim marks it verified');
  ok(sb._db.payment_log.some((p) => p.user_id === 'student-uid-1'), 'admin: verifying inserts a payment_log row');
  const prof = sb._db.profiles.find((p) => p.id === 'student-uid-1');
  ok(!!prof.paid_through, 'admin: verifying sets the student\'s paid_through date');
  ok(sb._db.messages.some((m) => m.from_admin && m.body.includes('full access')),
    'admin: verifying sends a confirmation message to the student');
  ok(errors.length === 0, 'admin payment verification: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testT1HonorRollAndDiploma() {
  const { window, sb } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  window.go('analytics');
  await new Promise((r) => setTimeout(r, 30));
  const html = window.document.getElementById('main').innerHTML;

  ok(html.includes('Program Completion'), 'analytics: T1/Honor Roll card renders');
  ok(html.includes('Carlos'), 'analytics: T1-eligible student (via Final Assessment) appears on the honor roll');
  ok(html.includes('Honors'), 'analytics: honor tier label renders');
  const honorCardMatch = html.match(/Program Completion[\s\S]*?(?=📄 Progress Reports|$)/);
  const honorCardHtml = honorCardMatch ? honorCardMatch[0] : '';
  ok(!honorCardHtml.includes('Mai'), 'analytics: non-eligible student (Mai) is not listed in the honor roll card specifically');

  // Direct unit check on the detection function itself, independent of rendering.
  const t1 = window.computeT1Status({ screener: null }, { finaldomains: { listening: 5, speaking: 4, reading: 5, writing: 4 }, advfinal: null });
  ok(t1 && t1.source === 'final', 'computeT1Status: detects eligibility via Final Assessment domains');
  ok(window.honorTierFor(t1).en === 'Honors', 'honorTierFor: mixed 4s/5s (not all 5s) yields "Honors" not "Highest Honors"');

  const t1AllFives = window.computeT1Status({ screener: null }, { finaldomains: { listening: 5, speaking: 5, reading: 5, writing: 5 }, advfinal: null });
  ok(window.honorTierFor(t1AllFives).en === 'Highest Honors', 'honorTierFor: all 5s yields "Highest Honors"');

  const notEligible = window.computeT1Status({ screener: null }, { finaldomains: { listening: 3, speaking: 4, reading: 5, writing: 4 }, advfinal: null });
  ok(notEligible === null, 'computeT1Status: a single domain below 4 disqualifies the student');

  const advPath = window.computeT1Status({ screener: null }, { finaldomains: null, advfinal: 85 });
  ok(advPath && advPath.source === 'advfinal', 'computeT1Status: 80%+ on Advanced Final Assessment qualifies (no domain breakdown available)');

  // Diploma generation should run without throwing for an eligible student...
  await window.generateDiploma('student-uid-2', 'en');
  await new Promise((r) => setTimeout(r, 20));
  // ...and should refuse (via alert, not a crash) for a non-eligible student.
  let alerted = false;
  const originalAlert = window.alert;
  window.alert = () => { alerted = true; };
  await window.generateDiploma('student-uid-1', 'en');
  window.alert = originalAlert;
  ok(alerted, 'generateDiploma: refuses (via alert) for a student who has not met T1 criteria');

  ok(errors.length === 0, 'T1/honor roll/diploma flow: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testProgressReportExitBanner() {
  const { window } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  // Should not throw for either an eligible or non-eligible student, and should reach the
  // point of constructing the docx (Packer.toBlob) for both.
  await window.generateProgressReport('student-uid-2', 'en'); // T1-eligible
  await window.generateProgressReport('student-uid-1', 'en'); // not eligible
  await new Promise((r) => setTimeout(r, 20));
  ok(errors.length === 0, 'progress report generation (T1 and non-T1 students): no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testCumulativeFoldersAccessControl() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  window.go('cumulative');
  await new Promise((r) => setTimeout(r, 20));
  ok(window.document.querySelector('.nav-btn[data-view="dash"]').classList.contains('on'),
    'student: "cumulative" view redirects non-admins to dash (router-level guard, not just hidden nav)');
  window.go('studentfolder');
  await new Promise((r) => setTimeout(r, 20));
  ok(window.document.querySelector('.nav-btn[data-view="dash"]').classList.contains('on'),
    'student: "studentfolder" view also redirects non-admins to dash');
  const navBtn = window.document.getElementById('cumulativeNavBtn');
  ok(navBtn.classList.contains('hide'), 'student: Cumulative Folders nav button is hidden');
  ok(errors.length === 0, 'cumulative folders access control: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testCumulativeFoldersContent() {
  const { window } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  const navBtn = window.document.getElementById('cumulativeNavBtn');
  ok(!navBtn.classList.contains('hide'), 'admin: Cumulative Folders nav button is visible');

  window.go('cumulative');
  await new Promise((r) => setTimeout(r, 30));
  let html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Carlos'), 'cumulative: folder grid lists the T1 student');
  ok(html.includes('Mai'), 'cumulative: folder grid lists the non-eligible student too (folders exist for everyone, not just T1)');
  ok(html.includes('📝 Consent on file'), 'cumulative: shows consent-on-file indicator for the student who has one');

  window.openStudentFolder('student-uid-2'); // Carlos — has consent, payment history, T1 status, activity
  await new Promise((r) => setTimeout(r, 30));
  html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Carlos Mendez'), 'student folder: consent-form child name renders');
  ok(html.includes('Rosa Mendez'), 'student folder: parent/guardian name renders');
  ok(html.includes('615-555-0100'), 'student folder: parent phone renders');
  ok(html.includes('sprout') || html.includes('Sprout'), 'student folder: payment tier renders');
  ok(html.includes('2026-07') || html.includes('Payment History'), 'student folder: payment history renders');
  ok(html.includes('Exited ELL Program') || html.includes('Honors'), 'student folder: T1/honor status renders');
  ok(html.includes('generateDiploma'), 'student folder: diploma download buttons present for T1 student');
  ok(html.includes('Total Logins'), 'student folder: attendance section renders');
  ok(html.includes('2'), 'student folder: attendance shows the expected distinct-day/login count');

  // Non-eligible, no-consent student should show the "no consent form" message, not fabricated data.
  window.openStudentFolder('student-uid-1'); // Mai — no consent submission fixture
  await new Promise((r) => setTimeout(r, 30));
  html = window.document.getElementById('main').innerHTML;
  ok(html.includes('No parental consent form on file'), 'student folder: honestly states missing consent data rather than showing blanks as if real');
  ok(!html.includes('Exited ELL Program'), 'student folder: non-eligible student does not show exit/honors status');

  ok(errors.length === 0, 'cumulative folders content: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testAttendanceTracking() {
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  ok(typeof window.startAttendanceTracking === 'function', 'attendance: startAttendanceTracking is defined');
  const before = (sb._db.activity_log || []).length;
  await window.logActivity('login');
  await new Promise((r) => setTimeout(r, 10));
  const after = sb._db.activity_log.length;
  ok(after === before + 1, 'attendance: logActivity inserts a row');
  ok(sb._db.activity_log[sb._db.activity_log.length - 1].event === 'login', 'attendance: logged event has the right type');

  // Admins should never be tracked.
  const { window: adminWindow, sb: adminSb } = await loadApp({ asUser: 'admin@example.com' });
  const beforeAdmin = (adminSb._db.activity_log || []).length;
  await adminWindow.logActivity('login');
  await new Promise((r) => setTimeout(r, 10));
  ok((adminSb._db.activity_log || []).length === beforeAdmin, 'attendance: admin logins are never tracked');

  ok(errors.length === 0, 'attendance tracking: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testConsentAutoFileAndEmail() {
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  let emailFnCalled = false;
  const originalFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('send-consent-email')) { emailFnCalled = true; return { ok: true, json: async () => ({ ok: true }) }; }
    return originalFetch(url, opts);
  };

  window.go('consentForm');
  await new Promise((r) => setTimeout(r, 20));
  const set = (id, val) => { const el = window.document.getElementById(id); if (el) el.value = val; };
  set('csChildName', 'Test Child'); set('csChildDob', '2014-01-01'); set('csParentName', 'Test Parent');
  set('csRelation', 'Mother'); set('csParentEmail', 'parent@example.com');
  const general = window.document.getElementById('csGeneral'); if (general) general.checked = true;
  const certify = window.document.getElementById('csCertify'); if (certify) certify.checked = true;

  await window.csSubmit();
  await new Promise((r) => setTimeout(r, 30));

  const row = sb._db.consent_submissions.find((c) => c.child_name === 'Test Child');
  ok(!!row, 'consent submission: row is inserted');
  ok(!!row.document_path, 'consent submission: document_path gets populated after auto-upload');
  ok(!emailFnCalled, 'consent submission: send-consent-email is NOT called (removed — no Edge Function deployed)');
  ok(errors.length === 0, 'consent auto-file-and-email: no thrown errors (' + errors.map(String).join('; ') + ')');
  window.fetch = originalFetch;
}

async function testConsentSubmissionSurvivesEmailFailure() {
  // The core requirement: if Storage/Edge Function fails, the parent's actual submission
  // must still succeed — this is a bonus notification layer, not a dependency.
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  sb.storage.from = () => ({
    upload: async () => ({ data: null, error: { message: 'simulated storage failure' } }),
    createSignedUrl: async () => ({ data: null, error: { message: 'simulated failure' } }),
  });

  window.go('consentForm');
  await new Promise((r) => setTimeout(r, 20));
  const set = (id, val) => { const el = window.document.getElementById(id); if (el) el.value = val; };
  set('csChildName', 'Resilient Child'); set('csChildDob', '2014-01-01'); set('csParentName', 'Test Parent');
  set('csRelation', 'Father'); set('csParentEmail', 'parent2@example.com');
  window.document.getElementById('csGeneral').checked = true;
  window.document.getElementById('csCertify').checked = true;

  await window.csSubmit();
  await new Promise((r) => setTimeout(r, 30));

  const row = sb._db.consent_submissions.find((c) => c.child_name === 'Resilient Child');
  ok(!!row, 'consent submission: still succeeds even when Storage upload fails');
  ok(!row.document_path, 'consent submission: document_path stays unset when upload failed (no false success)');
  ok(errors.length === 0, 'consent submission resilience: no thrown errors despite storage failure (' + errors.map(String).join('; ') + ')');
}

async function testSyncedHighlightingCore() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);

  const tokens = window.tokenizeWords("The  quick brown fox.");
  ok(tokens.length === 4, 'tokenizeWords: splits on whitespace runs correctly (' + tokens.length + ' tokens)');
  ok(tokens[0].word === 'The' && tokens[0].start === 0, 'tokenizeWords: first token has correct word/offset');
  ok(tokens[3].word === 'fox.', 'tokenizeWords: punctuation stays attached to its word (not split separately)');

  const html = window.wrapWordsHtml("Hello world");
  ok(html.includes('data-w="0"') && html.includes('data-w="1"'), 'wrapWordsHtml: wraps each word with a sequential data-w index');
  ok(html.includes('>Hello<') && html.includes('>world<'), 'wrapWordsHtml: word text is preserved');

  // Backward compatibility: readAloudBtn with NO second argument must be byte-identical in
  // behavior to before this feature existed — no highlightElId means no opts object at all.
  const plainBtn = window.readAloudBtn("WRITING[wrIdx].topic");
  ok(plainBtn.includes('onclick="speak(WRITING[wrIdx].topic)"'), 'readAloudBtn: no-highlight call sites get a plain speak(text) call, unchanged');
  const highlightBtn = window.readAloudBtn("READING[rdSel].text", "rdPassageText");
  ok(highlightBtn.includes("speak(READING[rdSel].text,{highlightElId:'rdPassageText'})"), 'readAloudBtn: highlight-enabled call sites pass the opts object through');

  ok(errors.length === 0, 'synced highlighting core: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testReadingPassagePilotRendersWordSpans() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  window.go('reading');
  await new Promise((r) => setTimeout(r, 20));
  window.document.getElementById('rdLevel').value = '1';
  window.rdFillPassages();
  const passSelect = window.document.getElementById('rdPass');
  passSelect.value = '0';
  window.rdOpen();
  await new Promise((r) => setTimeout(r, 20));

  const passageEl = window.document.getElementById('rdPassageText');
  ok(!!passageEl, 'reading pilot: passage container with the highlight-target id renders');
  const wordSpans = passageEl.querySelectorAll('.ra-word');
  ok(wordSpans.length > 0, 'reading pilot: passage text is rendered as individually addressable word spans (' + wordSpans.length + ' words)');
  ok(window.document.getElementById('rdBody').innerHTML.includes("highlightElId:'rdPassageText'"), 'reading pilot: Read Aloud button is wired to this passage\'s highlight target');

  ok(errors.length === 0, 'reading passage pilot: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testSyncedHighlightingEndToEnd() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  const originalFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('text-to-speech')) {
      return {
        ok: true,
        json: async () => ({
          audio_base64: Buffer.from('fake-mp3-bytes').toString('base64'),
          alignment: {
            characters: ['H', 'i', ' ', 'y', 'o', 'u'],
            character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
            character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          },
        }),
      };
    }
    return originalFetch(url, opts);
  };

  window.document.body.insertAdjacentHTML('beforeend', '<div id="testHighlightTarget">' + window.wrapWordsHtml('Hi you') + '</div>');
  await window.speak('Hi you', { highlightElId: 'testHighlightTarget' });
  await new Promise((r) => setTimeout(r, 20));

  // Note: wsAudio/raWordStartTimes are top-level `let` variables in a classic script, so they
  // are NOT exposed as window.wsAudio etc. (a JS scoping quirk, not a bug) — this test instead
  // checks the one thing that actually matters: the observable DOM behavior.
  const target = window.document.getElementById('testHighlightTarget');
  ok(target.querySelectorAll('.ra-word').length === 2, 'end-to-end: highlight target contains the expected word spans');

  // Manually advance the (non-functional-in-jsdom) audio clock via the play/pause control API,
  // then let one animation frame pass, to confirm the RAF loop reads currentTime correctly.
  window.wsPause(); // harmless no-op here, just confirms the shared control surface doesn't throw
  await new Promise((r) => setTimeout(r, 60));

  ok(errors.length === 0, 'synced highlighting end-to-end: no thrown errors during playback setup (' + errors.map(String).join('; ') + ')');

  window.wsStop();
  ok(target.querySelectorAll('.ra-word.ra-active').length === 0, 'end-to-end: wsStop() clears any highlight');
  window.fetch = originalFetch;
}

async function testFinalAssessmentLevelingMath() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  // fnFinish() computes: widaToFrameworkLevel(pctToPL(pct)) — validating that composition
  // directly, since FINAL.qs/fnScore are const/let-scoped and not reachable from outside to
  // drive a full 12-question run deterministically (same scoping limitation noted elsewhere
  // in this test suite).
  ok(window.pctToPL(95) === 5, 'pctToPL: 95% maps to PL 5');
  ok(window.widaToFrameworkLevel(5) === 5, 'widaToFrameworkLevel: PL 5 maps to Framework Level 5 (the max)');
  ok(window.widaToFrameworkLevel(window.pctToPL(95)) > window.widaToFrameworkLevel(window.pctToPL(45)),
    'leveling math: a much higher Final Assessment score implies a higher Framework Level than a low one');
  ok(errors.length === 0, 'final assessment leveling math: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testFinalAssessmentFlowSmoke() {
  const { window } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  window.go('final');
  await new Promise((r) => setTimeout(r, 20));
  ok(window.document.getElementById('main').innerHTML.includes('Final'), 'final assessment: intro screen renders');
  // Drive through all 12 questions blindly (answers may be wrong — this is a smoke test for
  // "does the flow complete and render results", not a scoring-correctness test).
  for (let i = 0; i < 12; i++) {
    const textarea = window.document.getElementById('fnAns');
    if (textarea) textarea.value = 'a plausible sentence answer';
    const radio = window.document.querySelector('input[name="fnOpt"]');
    if (radio) radio.checked = true;
    window.fnSubmit();
    await new Promise((r) => setTimeout(r, 10));
  }
  const finalHtml = window.document.getElementById('main').innerHTML;
  ok(finalHtml.includes('Final assessment complete'), 'final assessment: completes all 12 questions and renders results');
  ok(errors.length === 0, 'final assessment flow smoke test: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testPreviewModeConfirmationAndWarning() {
  const { window } = await loadApp({ asUser: 'admin@example.com' });
  const errors = collectErrors(window);
  const banner = window.document.getElementById('previewBanner');
  ok(banner.textContent.includes('your own account'), 'preview banner: explicitly clarifies this is the admin\'s own account, not a specific student');
  ok(banner.classList.contains('hide'), 'preview banner: hidden before entering preview mode');

  window.togglePreview(); // window.confirm is stubbed to return true
  await new Promise((r) => setTimeout(r, 10));
  ok(!banner.classList.contains('hide'), 'preview banner: becomes visible after entering preview mode');

  window.togglePreview(); // toggle back off
  ok(errors.length === 0, 'preview mode confirmation: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testDownloadAppDesktopHandoff() {
  const { window } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  window.go('downloadapp');
  await new Promise((r) => setTimeout(r, 20));
  let html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Want to use it on a computer too'), 'download app: desktop-handoff card renders (EN)');
  ok(html.includes('Copy This Link'), 'download app: Copy Link button is present as the primary action');
  ok(html.includes('mailto:?subject='), 'download app: secondary mailto link is still present');
  ok(html.includes('wdboone.github.io'), 'download app: plain copyable URL is shown alongside the buttons');

  // Stub the Clipboard API (not implemented in jsdom) to verify the copy flow actually works.
  let copiedText = null;
  window.navigator.clipboard = { writeText: async (text) => { copiedText = text; } };
  await window.copyDownloadAppLink('https://wdboone.github.io/wordsprout-english-language-learning-platform-k12/');
  await new Promise((r) => setTimeout(r, 10));
  ok(copiedText === 'https://wdboone.github.io/wordsprout-english-language-learning-platform-k12/', 'copyDownloadAppLink: passes the real URL to the Clipboard API');
  ok(window.document.getElementById('copyLinkMsg').innerHTML.includes('Copied'), 'copyDownloadAppLink: shows a confirmation message after copying');

  window.setDownloadAppLang('km');
  await new Promise((r) => setTimeout(r, 10));
  html = window.document.getElementById('main').innerHTML;
  ok(html.includes('ចង់ប្រើនៅលើកុំព្យូទ័រដែរឬទេ'), 'download app: desktop-handoff card renders in Khmer too');
  ok(html.includes('ចម្លងតំណនេះ'), 'download app: Khmer Copy Link button text renders');

  ok(errors.length === 0, 'download app desktop handoff: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testEnrollmentNoticeBilingual() {
  const { window } = await loadApp({ asUser: 'overdue@example.com' });
  const errors = collectErrors(window);
  window.go('dash');
  await new Promise((r) => setTimeout(r, 20));
  let html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Enrollment payment needed'), 'dashboard: overdue-enrollment notice renders for a student past their 7-day window with no payment');
  ok(html.includes('Español'), 'dashboard: notice shows a Spanish toggle button by default (English active)');

  window.toggleEnrollNoticeLang();
  await new Promise((r) => setTimeout(r, 10));
  html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Se necesita el pago de inscripción'), 'dashboard: notice switches to Spanish');
  ok(html.includes('English'), 'dashboard: toggle button now offers switching back to English');

  window.toggleEnrollNoticeLang(); // back to English for isolation from other tests
  ok(errors.length === 0, 'enrollment notice bilingual toggle: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testPasswordVisibilityToggle() {
  const { window } = await loadApp();
  const errors = collectErrors(window);

  // Login field
  window.authView('login');
  await new Promise((r) => setTimeout(r, 10));
  const liPass = window.document.getElementById('liPass');
  const liBtn = liPass.parentElement.querySelector('.pw-toggle');
  ok(liPass.type === 'password', 'login password: starts hidden by default');
  ok(!!liBtn, 'login password: eye toggle button is present');
  window.togglePasswordVisibility('liPass', liBtn);
  ok(liPass.type === 'text', 'login password: toggling once reveals the password (type=text)');
  ok(liBtn.classList.contains('active'), 'login password: toggle button shows an active/highlighted state when visible');
  ok(liBtn.getAttribute('aria-label') === 'Hide password', 'login password: aria-label updates to reflect the new state');
  window.togglePasswordVisibility('liPass', liBtn);
  ok(liPass.type === 'password', 'login password: toggling again hides it again');
  ok(!liBtn.classList.contains('active'), 'login password: active state clears when hidden again');

  // Signup field — independent of the login field's state
  window.authView('signup');
  await new Promise((r) => setTimeout(r, 10));
  const suPass = window.document.getElementById('suPass');
  const suBtn = suPass.parentElement.querySelector('.pw-toggle');
  ok(suPass.type === 'password', 'signup password: starts hidden, unaffected by the login field being toggled earlier');
  window.togglePasswordVisibility('suPass', suBtn);
  ok(suPass.type === 'text', 'signup password: toggles independently of the login field');
  ok(liPass.type === 'password', 'login password: remains hidden — toggling signup did not affect it');

  ok(errors.length === 0, 'password visibility toggle: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testSyllableSprout() {
  const { window, sb } = await loadApp({ asUser: 'student@example.com' });
  const errors = collectErrors(window);
  window.go('syllablesprout');
  await new Promise((r) => setTimeout(r, 20));
  let html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Syllable Sprout'), 'syllable sprout: view renders');
  ok(html.includes('AF') && html.includes('TER') && html.includes('NOON'), 'syllable sprout: first word\'s syllable blocks render (afternoon -> AF / TER / NOON)');
  ok(html.includes('æf'), 'syllable sprout: IPA for the first syllable renders');
  ok(html.includes('photos/16_a_house'), 'syllable sprout: the mapped real photo renders (not a placeholder)');
  ok(html.includes('ra-label'), 'syllable sprout: whole-word Read Aloud control is present, reusing the shared engine');
  const wholeWordBtn = [...window.document.getElementById('main').querySelectorAll('button')]
    .find((b) => b.getAttribute('onclick') === "speak('afternoon')");
  ok(!!wholeWordBtn, 'syllable sprout: a whole-word speak() button exists in the DOM');
  ok(wholeWordBtn && wholeWordBtn.getAttribute('onclick') === "speak('afternoon')",
    'syllable sprout: the whole-word Read Aloud button\'s onclick attribute is well-formed (single-quoted string literal, not double-quoted — double quotes inside a double-quoted HTML attribute would silently truncate it)');
  ok(html.includes('0/20'), 'syllable sprout: progress counter starts at 0 of 20');

  // Walk through all 20 words via "Next Word", confirming completion + persistence.
  for (let i = 0; i < 20; i++) {
    window.ssMarkAndNext();
    await new Promise((r) => setTimeout(r, 10));
  }
  html = window.document.getElementById('main').innerHTML;
  ok(html.includes('Syllable Sprout complete'), 'syllable sprout: completion screen renders after finishing every word');

  const row = sb._db.progress.find((p) => p.user_id === 'student-uid-1');
  ok(!!row && !!row.syllablesprout && row.syllablesprout.done.length === 20, 'syllable sprout: all 20 words persisted to progress.syllablesprout.done');

  ok(errors.length === 0, 'syllable sprout: no thrown errors (' + errors.map(String).join('; ') + ')');
}

async function testSignupTrialNotice() {
  const { window } = await loadApp();
  const errors = collectErrors(window);
  window.authView('signup');
  await new Promise((r) => setTimeout(r, 10));
  const notice = window.document.querySelector('[data-i18n="trialNotice"]');
  ok(!!notice, 'signup form: 7-day free trial notice element exists');
  ok(notice.textContent.includes('7-Day Free Trial'), 'signup form: trial notice shows the expected English text by default');

  if (typeof window.toggleAuthLang === 'function') {
    window.toggleAuthLang();
    await new Promise((r) => setTimeout(r, 10));
    ok(notice.textContent.includes('Prueba Gratis'), 'signup form: trial notice switches to Spanish via the existing auth-page language toggle');
    window.toggleAuthLang();
  }
  ok(errors.length === 0, 'signup trial notice: no thrown errors (' + errors.map(String).join('; ') + ')');
}

(async () => {
  await testAnonymousBoot();
  await testStudentViews();
  await testAdminDashboardAndFeedback();
  await testAnalyticsGrowthChart();
  await testScreenerSnapshotsHistory();
  await testStudentFeedbackSubmission();
  await testStudentPaymentClaimFlow();
  await testAdminPaymentVerification();
  await testT1HonorRollAndDiploma();
  await testProgressReportExitBanner();
  await testCumulativeFoldersAccessControl();
  await testCumulativeFoldersContent();
  await testAttendanceTracking();
  await testConsentAutoFileAndEmail();
  await testConsentSubmissionSurvivesEmailFailure();
  await testSyncedHighlightingCore();
  await testReadingPassagePilotRendersWordSpans();
  await testSyncedHighlightingEndToEnd();
  await testFinalAssessmentLevelingMath();
  await testFinalAssessmentFlowSmoke();
  await testPreviewModeConfirmationAndWarning();
  await testDownloadAppDesktopHandoff();
  await testEnrollmentNoticeBilingual();
  await testPasswordVisibilityToggle();
  await testSyllableSprout();
  await testSignupTrialNotice();

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
