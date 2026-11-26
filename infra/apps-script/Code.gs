/**
 * Bearsoft · Engineers intake (Google Apps Script, bound to the "Bearsoft · Engineers" Sheet).
 *
 * Receives one JSON POST per engineer from the bearsoft-connect Cloudflare Worker,
 * appends a row, and emails a plain-text alert. Deploy as a web app:
 *   Execute as: Me · Who has access: Anyone
 * The shared secret (Script Properties → SHARED_SECRET) is what protects the endpoint.
 *
 * Script Properties:
 *   SHARED_SECRET   same value as the Worker's SHEET_SECRET
 *   NOTIFY_EMAIL    jimmy@bearsoft.ai
 *   RETENTION_DAYS  730   (24 months; used by purgeOld)
 */

var SHEET_NAME = 'Engineers';
var COLUMNS = ['ts', 'login', 'name', 'email', 'company', 'location', 'blog', 'bio', 'public_repos',
  'followers', 'hireable', 'created_at', 'html_url', 'linkedin_url', 'note', 'consent_version', 'status'];
var MAX_LEN = 500;

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.secret || body.secret !== props.getProperty('SHARED_SECRET')) return json_({ ok: false, error: 'forbidden' });
    if (body.kind !== 'engineer' || !body.row || !body.row.login) return json_({ ok: false, error: 'bad_request' });

    var r = body.row;
    var values = COLUMNS.map(function (c) {
      if (c === 'ts') return new Date();
      if (c === 'status') return 'new';
      return clean_(r[c]);
    });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { sheet_().appendRow(values); } finally { lock.releaseLock(); }

    notify_(props.getProperty('NOTIFY_EMAIL'), r);
    return json_({ ok: true });
  } catch (err) {
    console.error('intake failed: ' + (err && err.message));
    return json_({ ok: false, error: 'server' });
  }
}

/** Strip control chars, cap length, and neutralise spreadsheet formula injection. */
function clean_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LEN);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(COLUMNS); sh.setFrozenRows(1); }
  return sh;
}

function notify_(to, r) {
  if (!to) return;
  var subject = 'New engineer: @' + clean_(r.login) + (r.name ? ' · ' + clean_(r.name) : '');
  var lines = [
    'Someone used "Continue with GitHub" on bearsoft.ai.',
    '',
    'GitHub:    ' + clean_(r.html_url || ('https://github.com/' + r.login)),
    'Name:      ' + clean_(r.name),
    'Email:     ' + clean_(r.email),
    'Location:  ' + clean_(r.location),
    'Company:   ' + clean_(r.company),
    'Repos:     ' + clean_(r.public_repos) + ' public · ' + clean_(r.followers) + ' followers · hireable: ' + clean_(r.hireable),
    'LinkedIn:  ' + clean_(r.linkedin_url),
    'Note:      ' + clean_(r.note),
    '',
    'Sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    'Promise on the site: we reply within 2 business days.'
  ];
  MailApp.sendEmail({ to: to, subject: subject, body: lines.join('\n'), name: 'Bearsoft intake' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the header row. */
function setup() { sheet_(); }

/**
 * Retention: delete engineer rows older than RETENTION_DAYS (default 730 = 24 months).
 * Add a time-driven trigger (daily) in Triggers to run this automatically.
 * Note: this uses the row's submission date; extend it to "last contact" if you add that column.
 */
function purgeOld() {
  var days = Number(PropertiesService.getScriptProperties().getProperty('RETENTION_DAYS') || 730);
  var cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  var sh = sheet_();
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] instanceof Date && data[i][0] < cutoff) sh.deleteRow(i + 1);
  }
}
