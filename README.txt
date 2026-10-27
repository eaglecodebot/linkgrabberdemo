LINK GRABBER WEB v6.3.0
======================

PERSONAL WORKFLOW EXTENSION v6.3.0
The console script remains available. Download my extension appears beside Copy
my script when that account has an active capture script. Every signed-in user
gets the same extension features with their own capture connection preinstalled.
An admin viewing another user's history still downloads the admin's own extension.

USER SETUP
1. Log in to your existing Link Grabber web panel.
2. If no active script exists, use Generate script / Regenerate script explicitly.
3. Click Download my extension beside Copy my script.
4. Extract your personal ZIP to a permanent folder on the PC.
5. Open chrome://extensions, enable Developer mode, click Load unpacked and
   select the extracted folder containing manifest.json. Edge uses edge://extensions.
6. Pin/open the extension. Its buttons are Trial | Grab Links | Cancel & Refund.
   Use Grab Links to collect. No script/key needs to be pasted in the extension.

GRAB LINKS
- Reuses the current matching webpage or a matching tab in the current window.
- Otherwise navigates the current tab to the configured webpage. Opens a new tab
  only when no current tab is available. Browser New Tab pages are supported.
- The main URL and enabled services still come only from the admin's web settings.
- An exact main URL is best for automatic navigation. When opening a wildcard
  pattern, * characters are removed to obtain its concrete starting URL.
- If the source site requires login, sign in there and click Grab Links again.
- Captures all selected-service links from the main document, decodes locally,
  then saves directly through the extension background worker. Reward links
  are never opened, followed or redeemed by the grabber.
- Ready links are collected immediately; incomplete pages get up to 3 seconds
  to show missing services. Initial page loading and network/database latency
  can take longer than this; a fixed 2–3 second end-to-end limit is not guaranteed.
- A bottom-right message on the webpage confirms success, duplicates or missing
  links. Source messages dismiss after 4/6/8 seconds for success/warning/error.
  The extension popup retains the most recent capture result for review.
- A workflow and a capture cannot run together. Stop the current workflow before
  using Grab Links; wait for capture to finish before starting Trial/Cancel.
- Trial and Cancel & Refund retain their supplied workflow definitions/settings.
  Configure their private URLs in extension Settings as before.

CONNECTION AND UPDATES
The extension uses the same permanent capture key as that user's console script.
It works without a panel session. It cannot read/export account history or access
admin controls. Keep a downloaded ZIP private because it contains the capture key.
Password changes, script revocation and account disablement revoke the extension
connection too. Regenerate the script in the panel, then download the new ZIP.
Existing active console scripts do not require regeneration for this upgrade.
For extension updates, extract the new ZIP over the same installed folder and
press Reload on chrome://extensions to retain that browser's workflow settings.
A page/service setting change is fetched on the next capture; a new source host
may require a browser website-access prompt. No GoLogin API is needed.
The extension is installed separately in each browser/profile where you use it.

DEPLOY THIS UPDATE
Upload every project file, including cloud/extension-template and both dependency
lockfiles, then redeploy Railway. Ctrl+F5 the web panel after deployment.
JSZip is a production dependency and is installed automatically by the Dockerfile.
No new environment variables. Keep the same MongoDB and SCRIPT_ENCRYPTION_KEY.
Personal ZIPs are generated on demand in memory; no real user key is in this
project archive. Source template files alone are not a personalized installation.

ORGANIZED TXT EXPORT v6.2.1
Export all TXT groups full links under YouTube, Lovable, Notion, NordVPN and
Headspace headings, with blank lines between sections. Empty sections are omitted.
Service-only TXT files remain plain URL lists. Download again also groups older
combined TXT snapshots using their original saved links. No links are deleted.

EXCEL EXPORT v6.2.0
TXT export remains available. Export Excel downloads one .xlsx workbook with a
separate worksheet for each service with matching links, in this order:
  YouTube, Lovable, Notion, Nord, Headspace
Each sheet has a Link header, then one complete URL per row in column A. URLs
are stored as literal text, preserving voucher codes and long/encoded values.
No service's links are put into another service's sheet. Empty sheets are omitted.
Each service tab also has Export Excel for a workbook containing only its links.

Excel uses the selected user, New/Exported/All status and search filters. It
exports all matching rows across pagination, within the existing 10,000-link and
8 MiB limits. Filenames use the Indian calendar date:
  Decoded_Links_YYYY-MM-DD.xlsx (combined)
  YouTube_YYYY-MM-DD.xlsx / Lovable_YYYY-MM-DD.xlsx / ... (single service)

Preparing either format marks those links exported without deleting them. To
export the same links in the other format, select All or Exported first. TXT
and Excel snapshots both appear in Export history. Download again recreates
the exact saved selection and worksheet grouping, even if current history or
capture settings later change. Admins can export/re-download the selected user's
files; ordinary users cannot access another account's exports.

Upgrade: replace the application files and lockfiles in GitHub and redeploy
Railway. The Docker build installs the included ExcelJS runtime dependency.
Refresh the panel with Ctrl+F5. No new environment variable, encryption-key
change, database reset or capture-script regeneration is needed.

HEADSPACE LINKEDIN VOUCHERS v6.1.4
Headspace is now matched to the supplied demo format:
  https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-...
Only checkout.headspace.com links with a nonempty voucherCode parameter count as
Headspace rewards. Generic Headspace home/code/help/work links are excluded.
LinkedIn safety/go wrappers are decoded locally; the full destination and exact
voucher encoding are retained. No reward link is opened or redeemed.
After deploying, enable Headspace in the ADMIN capture settings and Save.
Existing global service selections stay unchanged until the admin edits them.
No new env variable, database reset or permanent-script regeneration is needed;
existing v6 scripts load the updated service rules from Railway on each run.
The actual supplied wrapper was verified offline. Browser/API capture, duplicate
checking, category counts and Headspace TXT export use synthetic voucher codes.

SERVICE TAB VISIBILITY v6.1.3
Disabled services with no links matching the current history filters are hidden.
For example, Headspace (0) is hidden while Headspace capture is off. An enabled
service stays visible even at zero. If a disabled service has matching saved
links, its tab stays available so history and exports remain accessible.
Changing filters or selected users recalculates visibility. If the active tab
becomes hidden, the first visible service is selected. Keyboard navigation skips
hidden tabs. With no visible services, the panel shows a simple empty state.
Open panels pick up saved admin settings during their usual five-second refresh;
admin form edits are not overwritten by background refreshes. No env change or
script regeneration is needed. Redeploy and refresh with Ctrl+F5.

PANEL CLEANUP v6.1.2
The capture card has one Copy my script button. Raw code is collapsed under
View script; repeated explanations and the second copy button are removed.
If clipboard access is blocked, View script opens and selects the code for Ctrl+C.

Temporary panel notices close automatically: success/info after 4 seconds,
warnings after 6, errors after 8. The x button closes one immediately. Hover or
keyboard focus pauses dismissal while reading. A replacement message gets its
own timer; repeated background refresh errors are not shown continuously.
Revocation reasons stay in the capture card beside Regenerate script.
Redeploy and refresh panel tabs with Ctrl+F5. No env or script replacement needed.

DISPLAY UPDATE v6.1.1
Date/time now appears to the left of the URL, in the same row, in user and admin
histories. The URL stays one horizontally scrollable line. Redeploy and refresh
with Ctrl+F5. No environment variable, setting or script replacement is needed.

UPDATE FROM v6 — REVOCATION DISPLAY FIX
Upload/redeploy the updated application files, keep the same database and all
Railway variables, then refresh open panel tabs with Ctrl+F5. No new environment
variable, encryption key or general script replacement is needed. Existing
active v6 scripts continue to work.

When a password changes/resets, the earlier key stops working and the user must
log in again. The panel hides the script and shows the saved cause plus a
Regenerate script button. Self/admin revoke and disable/re-enable behave the same
way, with their own cause. Refreshing, signing in or clicking an old Copy button
does NOT silently make a replacement. Regenerate is an explicit user action.
Open panels check script state every two seconds and on focus; browser background
throttling or a lost connection can delay the visible update. The server rejects
revoked keys independently of the panel. A failed status check hides the script
and offers Check again. Disabled users cannot log in/regenerate until restored.
New accounts see Generate script first, then Copy my script.
Reasons for actions performed before this update were not recorded; old version
mismatches show a general credentials/account-change reason. A replacement
silently issued by an older panel before this update remains an active script;
this release does not retrospectively revoke those valid replacements.
See UPDATE_TO_v6_1.txt.

UPDATE FROM v5 / v5.0.1
1. Upload the CONTENTS of Link_Grabber_Web to your existing GitHub repository,
   replacing the application files. Let Railway redeploy.
2. Keep the same MongoDB database and Railway variables, especially the original
   SCRIPT_ENCRYPTION_KEY. There are NO new environment variables in v6.
3. Refresh the hosted panel with Ctrl+F5. An admin saves the main-page URL/pattern
   and chooses the services in Capture settings · all users.
4. Users on an older engine see its replacement reason and click Regenerate
   script, then Copy my script. This explicitly issues a fresh key.
   Old v4/v5 code shows an update message and cannot add captures in v6.
5. Save this updated script for reuse. Later URL/service setting changes are
   loaded from the server and do not require another script copy.
Accounts, passwords, saved links and exports remain in the same database. The
new shared admin settings start unconfigured; old personal page URLs are retained
but are not automatically promoted into shared settings. No database wipe.
See UPDATE_TO_v6_1.txt and DEPLOY_RAILWAY.txt.

ADMIN-ONLY CAPTURE SETTINGS
- Main webpage URL / pattern: use the final browser address. Wildcards (*) are
  allowed in the path/query, with an exact website hostname.
- Services: YouTube, Lovable, Notion, NordVPN and Headspace can each be enabled
  or disabled. The original four are selected by default; Headspace starts off.
- These shared settings apply to future captures for EVERY panel user.
- Users see a read-only summary. The API also rejects non-admin setting edits.
- No numeric minimum exists. At least one matching link from EACH enabled
  service must be present. Four YouTube links cannot replace a missing Notion.
- All matching links of enabled services are captured, with no per-service cap
  beyond the overall limits. Disabled services are filtered again on the server.
- If a selected service is missing, the script waits up to three seconds, names
  the missing services and saves nothing. Enable only services you need.
- Turning off all services pauses captures with an explicit error.
- Existing links remain available even after a service is disabled.
Settings changes affect the next run; the backend rechecks current settings
before saving if an admin changes them while a capture is in progress.

DAILY CAPTURE
1. Log in to the public Railway panel. First use: click Generate script, then
   Copy my script. If revoked, read the reason and click Regenerate script, then
   copy it. An active script can be copied again unchanged. Keep it private.
2. Open the admin-configured source page in any browser or GoLogin profile.
3. Open Developer Tools -> Console, paste the script and press Enter.
4. Check Saving to: username in the bottom-right source-page message. Wait for
   the confirmed saved/duplicate/error result before continuing.
5. Run the same script for another page, profile, tab or after a full page reload.
The panel can be closed or logged out during capture. A permanent script is
reusable code; it does not run automatically after a full source-page reload.
No extension, PC program, BAT, PowerShell, GoLogin API key or local receiver.
Normal capture does not replace your clipboard. Deliberate copy actions do.

HISTORY / EXPORTS
- Tabs show enabled services and any disabled services with matching saved
  history, with counts. Disabled empty tabs are hidden. Click a service tab to
  see only its links.
- Counts respect the selected user, search and New/Exported/All filters.
- Each tab keeps its own pagination, Copy displayed links, Export TXT and
  Export Excel.
- Each entry shows the IST date/time on the LEFT, the full URL in the middle,
  and Copy on the right, all in the same row.
  Long links stay on one line with horizontal scrolling; saved URLs are intact.
- Service exports include all matching rows across pages, one URL per line:
    YouTube_YYYY-MM-DD.txt, Lovable_YYYY-MM-DD.txt, Notion_YYYY-MM-DD.txt,
    NordVPN_YYYY-MM-DD.txt, Headspace_YYYY-MM-DD.txt
- Export all TXT produces Decoded_Links_YYYY-MM-DD.txt. Export Excel creates
  a combined workbook with separate service sheets. Existing links are marked
  exported, not deleted. Select All or Exported to see them after exporting.
- Export history keeps snapshots available for another download later.
- Admins can view each user's history and export snapshots. Their own capture
  script always saves to their own account, regardless of the selected history.
- Both panels use dark mode. A session-loading view prevents the login form
  flashing while an existing login is restored on refresh.

PERMANENT SCRIPTS / ACCESS
Each user has one encrypted permanent script in MongoDB. Copying returns the
same code across logout/login, PC/browser restarts and Railway redeploys when
using the same database/domain/encryption key. An older engine requires explicit
regeneration; ordinary admin setting edits do not change active code.
- Password changes/resets, disabling a user, Revoke my scripts, and the admin's
  per-user Revoke script action stop previous copies. History remains intact.
- The panel hides revoked code, preserves the cause, and offers Regenerate
  script. Enabled users explicitly regenerate then copy; old keys stay invalid.
- Signing out alone does not revoke a script. GoLogin accounts are unrelated.
- A valid Bob script saves to Bob even while another panel tab is signed in as
  Alice. The visible username identifies the owner, not the physical operator.
- The scoped key can save supported links and read limited capture configuration.
  It cannot read history, export, change settings/passwords or manage users.
- The encryption secret and panel login token are never embedded in scripts.
- A future panel-domain or capture-engine change can require another copy.

SOURCE-PAGE RESULTS
Green: new links confirmed saved. You can continue.
Red duplicates: all links already saved or repeated; nothing added.
Amber: new links saved and duplicate links skipped, with separate counts.
Red missing: no enabled links or named services missing after the grace period;
  nothing saved. Let the source finish loading and rerun if needed.
Red access: wrong page, unconfigured/paused capture, outdated/revoked script,
  inactive account or a save that could not be confirmed.
Deduplication uses the full decoded URL within the account, including exported
history and other capture labels. Different users' records remain separate.
Repeated anchors are included once. Retrying the same batch retains its original
insert count without adding rows; each new execution has a new batch ID.

BROWSER FALLBACKS
The script normally reads current configuration and saves directly to Railway.
If the source website blocks cross-site requests, a Railway save window handles
configuration/saving at its own origin. If popup opening is blocked, click Open
save window in the message. Current settings and confirmed results are exchanged
with the source when browser window messaging permits it.
If COOP isolates the windows, the save window validates the opening snapshot
and shows the result itself. The original source message stays informational;
continue only after seeing a confirmed result. Reopen the save window to capture
links that appeared later. The URL fragment is removed before network requests.
If direct requests and popups are both blocked, use Copy capture packet, paste
LG_WEB_V6:... into Manual capture handoff in your panel, and confirm there.
Another user's packet cannot be imported into your account.
No destination reward is opened or redeemed; source cookies are not read.

SUPPORTED LINKS
LinkedIn safety/go wrappers are unwrapped while preserving the full destination
and signed query encoding. Direct supported reward URLs work too:
- youtube.com / www.youtube.com: nonempty acc query.
- lovable.dev / www.lovable.dev: nonempty reward_code query.
- notion.com / www.notion.com: nonempty code query.
- nordvpn.com / www.nordvpn.com: nonempty code query.
- Headspace: checkout.headspace.com with a nonempty voucherCode query, matching
  the supplied LinkedIn checkout-voucher format.
The supplied Headspace wrapper was decoded and verified offline; synthetic
vouchers are used in the packaged tests. The live LinkedIn DOM and checkout
redemption were not visited. Routine recognition rules are read from Railway,
so this recognition update does not require replacing users' v6 scripts.
Only main-document a[href] links are read. No iframe/shadow-root/click-only
adapters or universal redirect resolver. Limit: 5,000 unique links / 2 MiB packet.

TIMING / STORAGE
Already loaded links are collected after a short debounce; successful saves need
configuration, network and MongoDB acknowledgement. Three seconds is the missing-
link grace period, not a guaranteed remote save time. Keep Railway available for
prompt responses. A blocked-request fallback or slow network can take longer.
There is no offline queue. Retry or check history if confirmation is interrupted.
Keep MongoDB backups and the original SCRIPT_ENCRYPTION_KEY backed up privately.
History lives in MongoDB and is independent of the PC, subject to database
retention/storage and backups. TXT files download only when requested.
Any nonempty password up to 128 characters is accepted. Existing passwords do
not change on deployment. ADMIN_PASSWORD only creates an absent initial admin;
change an existing password through the panel.

DEVELOPERS
Node 24 / MongoDB driver 7.7.0 / ExcelJS 4.4.0. Start: npm start or node cloud/server.mjs.
Railway: root /, cloud/Dockerfile, health /health, bind 0.0.0.0 on Railway PORT.
Scripts use AES-256-GCM, context-bound to owner/auth version/revision, and a
hashed capture-key lookup. Permanent records have no TTL. Legacy settings stay
in the database; the shared settings document is settings/global:capture.
Legacy authenticated sync endpoints remain for migration and enforce enabled
services. No local receiver ships. Exports are limited to 10,000 matching rows.
Tests: npm ci, npm test. Optional: npm run test:browser with installed Chrome/Edge
or CHROME_PATH. See TEST_RESULTS.txt for verified behavior and live-test limits.
