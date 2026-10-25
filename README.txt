LINK GRABBER WEB v5 — PERMANENT USER SCRIPTS
==========================================

WHAT CHANGED
- Each panel user has one permanent private script, stored encrypted in MongoDB.
- Copy my script returns exactly the same saved code across panel logouts,
  browser/PC restarts and Railway redeploys using the same database/domain/key.
- Scripts have no automatic expiry. Old v4 timed scripts do not become permanent;
  copy your new v5 script once after updating.
- Each run loads the current main-page URL, minimum and default capture label.
  Routine settings changes do not require replacing the permanent script.
- Every source-page result and save window prominently shows Saving to: username.
- Password changes/resets, account disabling, self-revocation and admin revocation
  stop old scripts. Enabled users can then copy a distinct replacement.
- Dark panels, four service sections, duplicate/missing-link results, TXT export,
  private user histories, short passwords and browser fallbacks are retained.

ONE-TIME RAILWAY SETUP — ADMIN ONLY
Permanent scripts must be recoverable for copying, so they are encrypted in
MongoDB with a deployment secret stored separately in Railway.
1. Extract the ZIP. Open GENERATE_SCRIPT_ENCRYPTION_KEY.html in your browser.
2. Click Generate initial setup value once, then Copy variable line.
3. In Railway -> your service -> Variables -> Raw Editor, add that line:
     SCRIPT_ENCRYPTION_KEY=<the generated 64-character random hex value>
4. KEEP all existing variables and the same MongoDB database:
     MONGODB_URI, MONGODB_DB, ADMIN_USERNAME, ADMIN_PASSWORD, PUBLIC_URL
5. Keep the exact SCRIPT_ENCRYPTION_KEY on future deploys and store a private
   backup. Do not commit the generated value to GitHub. The generator itself
   contains no secret and sends nothing over the network.
Users do not perform this setup. They need only the hosted panel and their script.
Without a valid secret the panel/history still load, but copying permanent scripts
shows a setup error. A different secret cannot decrypt scripts already stored.

DEPLOY / UPGRADE
1. Before retiring an older Windows receiver, confirm its cloud sync is complete.
   Keep its local data folder until required captures/snapshots are verified online.
2. Add SCRIPT_ENCRYPTION_KEY as above. There is one new variable in v5.
3. Upload the CONTENTS of Link_Grabber_Web into your existing GitHub repository
   root, replacing matching files. Include cloud, public, src and railway.json.
   Do not upload old data, node_modules, real environment files or generated keys.
4. Let Railway rebuild with cloud/Dockerfile. Keep the service root at / and:
     node cloud/server.mjs
   Root npm start also starts the cloud backend. Railway supplies PORT.
5. Open your public Railway URL and refresh with Ctrl+F5. Existing accounts,
   passwords, saved links, settings and export snapshots remain in the same DB.
6. Save your main-page settings, then click Copy my script to obtain v5 once.
A permanent_scripts collection/index is added automatically; no database wipe.
The users' PCs need no BAT, PowerShell, Node installation, extension or local app.

DAILY CAPTURE
1. Log in to your Railway panel. Under Your capture setup, save the FINAL main
   webpage URL/pattern, minimum matching links and optional default capture label.
   Use * in the path/query, with an exact hostname. Four is a minimum, not a cap.
2. Click Copy my script. Both copy buttons fetch your current saved script from
   the server, including after a revocation/password change.
3. Open your source page in any browser/GoLogin profile, open Developer Tools ->
   Console (usually Ctrl+Shift+J on Windows Chromium), paste and press Enter.
4. Check the bold Saving to: username line. Wait for the saved/duplicate/error
   result before continuing. Green confirms that MongoDB acknowledged the save.
5. Paste and run the same script for another page, tab, browser profile or refresh.
   Permanent means reusable code; a script does not survive a full page reload.
The panel can be closed or logged out during capture. The script identifies its
owner independently of a panel session or GoLogin account. Normal saving does
not replace clipboard contents, so the script can remain ready to paste again.
Only deliberate copy actions/manual handoff replace clipboard contents.

OWNERSHIP AND ACCESS
A valid script belonging to Bob saves to BOB, even if another panel tab is logged
in as Alice. The visible username reduces mistakes; the script cannot determine
who is physically using the computer. Keep each user's script private.
The capture key permits saving supported links and reading limited capture setup
(username, main-page pattern, minimum and label). It cannot read saved history,
export files, manage users, change a password or choose another account owner.
An invalid/revoked key or wrong source page shows an error and saves nothing.
The initial username banner identifies the original script owner; successful
configuration and save responses confirm the username from the server.

PERMANENCE AND SECURITY CHANGES
Routine settings edits, panel logout/login, browser/PC restarts and Railway
restarts do not rotate the permanent script. The same encrypted code is returned
from MongoDB each time. A settings edit affects the next run; if settings change
during a run, the backend validates the current settings again before saving.
- Change/reset password: previous login sessions and scripts stop working.
- Disable a user: login and capture stop. Re-enabling still needs a replacement.
- Revoke my scripts: old keys stop; history/password stay intact. Copy my script
  creates a new permanent replacement for the enabled user.
- Admin Revoke script: same targeted effect for the selected user, without
  changing their password or deleting their links. Admins can also disable access.
Newly issued replacement scripts are different; the previous copies remain
invalid. Signing out alone does not revoke a script. Old timed v4 keys keep their
old expiry/restrictions during transition and are also covered by revocation.
The saved script includes your panel's domain. If you change that domain or need
a future capture-code upgrade, preserve the old endpoint or explicitly revoke
and copy a replacement. Routine page settings need no script update.

RESULTS ON THE SOURCE WEBPAGE
Every message keeps the Saving to: username line visible:
- Green: new links saved; continue.
- Red: all links duplicate; nothing added.
- Amber: new links saved and duplicate links skipped, showing both counts.
- Red after about three seconds: no matching links or fewer than your minimum;
  nothing saved. Wait for full page load and rerun if that page is slower.
- Red: invalid/revoked script, wrong source page or save not confirmed.
Duplicate checking uses the complete decoded URL within the same panel user's
history, including exported records and other capture labels. Repeated matching
anchors are included once and counted. Identical links in different users'
histories are separate. Existing historical duplicates/old snapshots are retained.
A repeated delivery of the same packet does not add rows and preserves its original
saved-count result, including after a lost response. New executions get new IDs.

WHEN THE WEBSITE BLOCKS CROSS-SITE REQUESTS
The script normally fetches current setup and submits directly to Railway.
If that website blocks the request, the small Railway save window handles setup
and saving through its own origin. No browser security setting is disabled.
- If automatic opening is blocked, click Open save window in the on-page message.
- When window messaging works, the save window sends current settings back to
  the source page. The source waits for the configured minimum and returns links.
  The confirmed result appears on the source page and the save window closes.
- Some sites isolate windows (COOP). Then the save window validates/saves the
  snapshot collected when opened and displays the username/result itself. The
  source message stays informational until it actually receives confirmation.
  If more links load later, return to the source page and click Open save window
  again to send a fresh snapshot. Do not continue based on an informational notice.
- If both paths are blocked, use Copy capture packet, then paste LG_WEB_V5:... into
  Manual capture handoff in your own Railway panel and save. The panel rejects
  another user's packet and shows the confirmed owner/result.
- Very large snapshots use manual handoff instead of a save-window URL.
The save-window URL fragment is removed immediately and is not sent as a server
URL/referrer. No reward destination is visited. Browser policy may require an
extra click or confirmation in the save window; automatic original-tab results
cannot be guaranteed on every website/browser policy.

NETWORK / PERFORMANCE
A normal run reads current setup, then saves supported links. Source links already
present are collected after a short debounce. Three seconds is the wait for missing
links, not a guarantee of network/database response time. Railway, MongoDB and the
network determine confirmed-save latency. The script falls back to the save window
when it cannot fetch setup or confirm submission directly.
There is no offline/local queue. Keep the page/result available and retry if saving
is not confirmed. A failed/lost response can follow a committed write; retry the
same packet safely, or check cloud history. Success follows the database write.

SUPPORTED LINKS
- youtube.com / www.youtube.com with acc.
- lovable.dev / www.lovable.dev with reward_code.
- notion.com / www.notion.com with code.
- nordvpn.com / www.nordvpn.com with code.
LinkedIn /safety/go/?url=... wrappers are decoded once per wrapper. Complete URLs
and reward-code encodings are preserved. Direct supported reward URLs work too.
Only ordinary a[href] in the main document are read; no iframe/shadow-root/click-
only adapters are included. Limits: 5,000 unique links and a 2 MiB capture packet.
This is not a universal resolver for unknown redirect/encryption formats.
The script does not read cookies/source credentials or visit/redeem destinations.
Only matching URLs, anchor labels, source URL/title and capture metadata go to
YOUR Railway server. Main-page checks happen on the server before any save.

HISTORY / EXPORTS
The four service sections have their own counts, pagination, copy controls and
TXT export buttons. Search and New/Exported/All filters apply across sections.
Each section exports all matching rows for its service, across pages, with one
unique full URL per line. Filenames use Indian time (Asia/Kolkata):
  YouTube_YYYY-MM-DD.txt / Lovable_YYYY-MM-DD.txt
  Notion_YYYY-MM-DD.txt / NordVPN_YYYY-MM-DD.txt
Export all TXT keeps the combined Decoded_Links_YYYY-MM-DD.txt option.
Exported links remain available; snapshots can be downloaded again. TXT files
only download to a PC when requested. Cloud export limit: 10,000 matching records.
Admins can view a selected user's history/exports. Your capture setup always
belongs to the signed-in account, even while viewing another user's history.

PASSWORDS / STORAGE
Any non-empty password up to 128 characters is accepted, as in v4.0.1.
Existing passwords are not changed by deployment. Change/reset them in the panel;
editing ADMIN_PASSWORD in Railway does not reset an existing administrator.
History and snapshots remain in MongoDB. The panel stores its login only for that
browser tab; the permanent script comes from encrypted server storage. Keep MongoDB
backups, a private backup of SCRIPT_ENCRYPTION_KEY and monitor database storage.

DEVELOPERS / VERIFICATION
Node 24, MongoDB driver 7.7.0. Start: npm start / node cloud/server.mjs.
Railway Dockerfile: cloud/Dockerfile. Health: /health.
Permanent scripts use AES-256-GCM with user/version/revision context. The random
capture key is looked up by a SHA-256 hash; no server encryption secret or login
session is embedded. The permanent_scripts collection has no expiry/TTL index.
Tests: npm ci, npm test. Optional browser tests: npm run test:browser with an
installed Chrome/Edge or CHROME_PATH. See TEST_RESULTS.txt for verification limits.
Legacy authenticated sync endpoints remain for migration; no PC receiver ships.
