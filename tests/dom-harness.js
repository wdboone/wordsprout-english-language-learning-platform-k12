'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeFakeSupabase } = require('./fake-supabase');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');

// Builds seed data for two accounts: an admin and a regular (enrolled, 13+) student.
function buildFixtures() {
  const adminId = 'admin-uid-1';
  const studentId = 'student-uid-1';
  const t1StudentId = 'student-uid-2';
  return {
    _users: [
      { id: adminId, email: 'admin@example.com' },
      { id: studentId, email: 'student@example.com' },
      { id: t1StudentId, email: 't1student@example.com' },
      { id: 'student-uid-3', email: 'overdue@example.com' },
    ],
    profiles: [
      { id: adminId, username: 'Admin', email: 'admin@example.com', is_admin: true, consent_status: 'not_required',
        payment_tier: 'sprout', paid_through: new Date().toISOString().slice(0,10), fee_waiver: false,
        first_name: 'Admin', last_name: 'User', grade: '', dob: '1990-01-01' },
      { id: studentId, username: 'Mai', email: 'student@example.com', is_admin: false, consent_status: 'not_required',
        payment_tier: 'sprout', paid_through: new Date().toISOString().slice(0,10), fee_waiver: false,
        first_name: 'Mai', last_name: 'Nguyen', grade: '5', dob: '2013-01-01' },
      { id: t1StudentId, username: 'Carlos', email: 't1student@example.com', is_admin: false, consent_status: 'not_required',
        payment_tier: 'sprout', paid_through: new Date().toISOString().slice(0,10), fee_waiver: false,
        first_name: 'Carlos', last_name: 'Mendez', grade: '8', dob: '2010-01-01' },
      { id: 'student-uid-3', username: 'Overdue', email: 'overdue@example.com', is_admin: false, consent_status: 'not_required',
        payment_tier: null, paid_through: null, fee_waiver: false,
        first_name: 'Sam', last_name: 'Overdue', grade: '6', dob: '2012-01-01',
        enrollment_deadline: new Date(Date.now() - 10*86400000).toISOString().slice(0,10) },
    ],
    progress: [
      { user_id: studentId, listening: {done:[],saved:{}}, speaking: {done:[],saved:{}}, reading: {done:[],saved:{}},
        writing: {done:[],saved:{}}, wordanatomy: {done:[],saved:{}}, screener: { overallPL: 3, frameworkLevel: 3 } },
      { user_id: t1StudentId, listening: {done:[],saved:{}}, speaking: {done:[],saved:{}}, reading: {done:[],saved:{}},
        writing: {done:[],saved:{}}, wordanatomy: {done:[],saved:{}}, screener: { overallPL: 4, frameworkLevel: 5 } },
    ],
    scores: [
      { user_id: studentId, badges: [] },
      { user_id: t1StudentId, badges: [], listening: 92, speaking: 95, reading: 90, writing: 93, final: 92,
        finaldomains: { listening: 5, speaking: 4, reading: 5, writing: 4 } },
    ],
    payment_log: [
      { id: 1, user_id: t1StudentId, month_covered: '2026-07', tier: 'sprout', confirmed_by: adminId, created_at: new Date().toISOString() },
    ],
    score_history: [
      // t1StudentId (Carlos): two checkpoints — an early module-assessment snapshot with no
      // screener data yet, then a later one after a Screener retake (overall_pl populated).
      { id: 1, user_id: t1StudentId, listening: 70, speaking: 65, reading: 72, writing: 68, final: null,
        overall_pl: null, recorded_at: new Date(Date.now() - 30 * 86400000).toISOString() },
      { id: 2, user_id: t1StudentId, listening: 92, speaking: 95, reading: 90, writing: 93, final: 92,
        overall_pl: 4, recorded_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    ],
    homework: [
      { id: 1, user_id: studentId, file_name: 'essay.docx', storage_path: 'x', student_comment: 'Please check my grammar', status: 'submitted', created_at: new Date().toISOString() },
    ],
    messages: [
      { id: 1, user_id: studentId, topic: 'Question about an exercise', body: 'How do I use "although"?', from_admin: false, status: 'new', created_at: new Date().toISOString() },
    ],
    feedback: [
      { id: 1, user_id: studentId, category: '💡 Feature Request', rating: 5, body: 'Add dark mode!', status: 'new', created_at: new Date().toISOString() },
    ],
    consent_submissions: [
      { id: 1, user_id: t1StudentId, child_name: 'Carlos Mendez', child_dob: '2010-04-12', child_grade: '8',
        child_home_language: 'Spanish', school_state: 'Tennessee', school_district: 'Metro Nashville Public Schools',
        parent_name: 'Rosa Mendez', relation: 'Mother', address: '123 Main St, Nashville, TN', parent_email: 'rosa@example.com',
        phone: '615-555-0100', status: 'enrolled', submitted_at: new Date().toISOString() },
    ],
    fee_waivers: [],
    activity_log: [
      { id: 1, user_id: t1StudentId, event: 'login', created_at: new Date(Date.now() - 2*86400000).toISOString() },
      { id: 2, user_id: t1StudentId, event: 'heartbeat', created_at: new Date(Date.now() - 2*86400000 + 300000).toISOString() },
      { id: 3, user_id: t1StudentId, event: 'heartbeat', created_at: new Date(Date.now() - 2*86400000 + 600000).toISOString() },
      { id: 4, user_id: t1StudentId, event: 'login', created_at: new Date().toISOString() },
    ],
    payment_claims: [
      { id: 1, user_id: studentId, tier: 'sprout', month_covered: new Date().toISOString().slice(0,7), status: 'pending', created_at: new Date().toISOString() },
    ],
  };
}

function stripExternalScripts(html) {
  return html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>\s*/g, '');
}

const STUB_SCRIPT = `<script>
window.supabase = { createClient: function(){ return window.__FAKE_SB__; } };
window.Chart = function(){ this.destroy=function(){}; this.update=function(){}; };
window.docx = { Document: function(){}, Packer: { toBuffer: async()=>new Uint8Array(), toBlob: async()=>({size:0,type:"application/octet-stream"}) },
  Paragraph: function(){}, TextRun: function(){}, ImageRun: function(){}, Table: function(){}, TableRow: function(){}, TableCell: function(){},
  AlignmentType:{CENTER:"center",LEFT:"left",RIGHT:"right"}, WidthType:{DXA:"dxa",PERCENTAGE:"pct"}, BorderStyle:{SINGLE:"single",DOUBLE:"double",NONE:"none"},
  ShadingType:{CLEAR:"clear"}, VerticalAlign:{CENTER:"center"}, HeadingLevel:{HEADING_1:"h1"}, PageBorderDisplay:{ALL_PAGES:"allPages"},
  PageBorderOffsetFrom:{PAGE:"page"}, PageOrientation:{LANDSCAPE:"landscape"} };
window.fetch = window.fetch || (async()=>({ ok:true, json: async()=>({content:[]}) }));
if(!window.URL.createObjectURL) window.URL.createObjectURL = function(){ return "blob:fake-url"; };
</script>
`;

async function loadApp({ asUser } = {}) {
  const html = stripExternalScripts(fs.readFileSync(INDEX_PATH, 'utf-8'))
    .replace('<!-- ================= SUPABASE CLIENT (prepped ahead of time; not yet wired into auth logic) ================= -->', STUB_SCRIPT);

  const fakeSb = makeFakeSupabase(buildFixtures());
  if (asUser) {
    const user = fakeSb._db._users.find((u) => u.email === asUser);
    fakeSb.auth._setSession({ user, access_token: 'fake-token' });
  }

  const dom = new JSDOM(html, {
    url: 'https://example.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: undefined,
    beforeParse(window) {
      window.__FAKE_SB__ = fakeSb;
      window.alert = () => {};
      window.confirm = () => true;
      window.scrollTo = () => {};
    },
  });

  // Let the boot IIFE's awaited getSession()/loadUserFromSupabase() resolve.
  await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 0));

  return { dom, window: dom.window, sb: fakeSb };
}

module.exports = { loadApp, buildFixtures };
