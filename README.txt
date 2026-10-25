LINK GRABBER WEB v6.1.0
======================

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
- Tabs across the top show YouTube (count), Lovable (count), Notion (count),
  NordVPN (count) and Headspace (count). Click a tab to see that service alone.
- Counts respect the selected user, search and New/Exported/All filters.
- Each tab keeps its own pagination, Copy displayed links and Export TXT.
- Entries show only the full URL and date/time in Indian time (Asia/Kolkata).
  Long links stay on one line with horizontal scrolling; saved URLs are intact.
- Service exports include all matching rows across pages, one URL per line:
    YouTube_YYYY-MM-DD.txt, Lovable_YYYY-MM-DD.txt, Notion_YYYY-MM-DD.txt,
    NordVPN_YYYY-MM-DD.txt, Headspace_YYYY-MM-DD.txt
- Export all TXT produces Decoded_Links_YYYY-MM-DD.txt. Existing links are marked
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
- Headspace: headspace.com, checkout.headspace.com, work.headspace.com;
  code/voucher/promo/coupon queries, redemption/checkout paths or LinkedIn paths.
Headspace patterns cover official redemption/checkout forms. A real LinkedIn
Headspace perk sample was not supplied or live-tested; a different destination
format may need an additional server-side recognition rule. v6 fetches rules from
Railway, so routine recognition-rule updates need no user script regeneration.
Official examples: https://www.headspace.com/code and
https://checkout.headspace.com/checkout?origin=modal&voucherCode=ANNUAL40OFF
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
Node 24 / MongoDB driver 7.7.0. Start: npm start or node cloud/server.mjs.
Railway: root /, cloud/Dockerfile, health /health, bind 0.0.0.0 on Railway PORT.
Scripts use AES-256-GCM, context-bound to owner/auth version/revision, and a
hashed capture-key lookup. Permanent records have no TTL. Legacy settings stay
in the database; the shared settings document is settings/global:capture.
Legacy authenticated sync endpoints remain for migration and enforce enabled
services. No local receiver ships. Exports are limited to 10,000 matching rows.
Tests: npm ci, npm test. Optional: npm run test:browser with installed Chrome/Edge
or CHROME_PATH. See TEST_RESULTS.txt for verified behavior and live-test limits.
