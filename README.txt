LINK GRABBER v2 — LINKEDIN REWARD DECODER + CLOUD LOGIN
=====================================================

WHAT CHANGED
Set your main webpage once. The collector reads matching links, extracts the
URL embedded in LinkedIn safety/go wrappers, and saves the COMPLETE decoded
reward URL. Nothing is cut out of the reward URL or its code.
There are no separate saver sections: all results go into one searchable list.

Supported reward URLs:
- youtube.com / www.youtube.com with a nonempty acc parameter.
- lovable.dev / www.lovable.dev with a nonempty reward_code parameter.
- notion.com / www.notion.com with a nonempty code parameter.
- nordvpn.com / www.nordvpn.com with a nonempty code parameter.

The LinkedIn wrapper must contain one url parameter holding a valid HTTP/HTTPS
URL. Already decoded supported reward links work too. Other service homepages,
help links, unrelated destinations and unsafe protocols are excluded.
This is offline URL decoding, not a universal shortener/redirect resolver.
Unknown redirect services or encrypted destination formats need their own
adapter. No destination is opened, downloaded, visited or redeemed.

UPDATING AN EXISTING INSTALLATION
Stop & sync profiles and exit the old app. Extract the new files into the same
app folder, keeping its existing data folder. Run SETUP_WINDOWS.bat again.
Do not delete data while replacing the program files.

QUICK LOCAL TEST (WINDOWS)
1. Extract the whole ZIP to a normal folder, for example Documents\LinkGrabber.
2. Install Node.js 24 LTS from https://nodejs.org/ (version 24.x).
3. Run SETUP_WINDOWS.bat once. Installation needs internet access.
4. Run START_WINDOWS.bat. The panel opens at http://127.0.0.1:8765.
5. Click Try demo. It uses installed Chrome/Edge and FAKE reward codes.
   Three fake links appear immediately and a fourth after two seconds.
   Only decoded reward links should appear in Your decoded links.
6. Local mode works without MongoDB/Railway, but is NOT a cloud backup.

FOR YOUR REAL MULTI-USER SETUP
Deploy the cloud backend first using DEPLOY_RAILWAY.txt.
The cloud backend handles authentication and persistent per-user history.
MongoDB Atlas stores users, decoded links, settings and export snapshots.
The GoLogin collector and desktop popup run on each user's Windows PC.
Railway does not launch the GoLogin profiles on users' PCs.

LOG IN TO THE PANEL
1. At the top of the local panel, enter your Railway backend's base URL.
2. Enter the panel username/password created by the administrator.
3. Click Log in. Your own local cache, GoLogin account connections and history
   are loaded separately from other panel users.
4. The cloud status shows queued captures and any sync errors.
5. For history from another PC, choose Cloud history above the saved-links list.
   This retrieves your own MongoDB history even when this PC's cache is empty.
6. Open cloud history / admin panel opens the hosted website. Log in there too.
   You can use the hosted website to download history without running GoLogin.

The login is remembered locally in an encrypted session file. Cloud sessions
expire after seven days. Logging out or resetting/disabling a user revokes the
appropriate cloud sessions. The local collector can queue data during a
connection outage, but cannot bypass cloud account permissions.
Stop & sync every profile before switching panel users or logging out.

ADMINISTRATOR
Open the Railway backend URL and log in using the admin account configured
at first startup. You can:
- Create regular users with initial passwords of at least 12 characters.
- Open a selected user's own capture history and export history.
- Prepare/download that user's TXT exports.
- Reset a regular user's password or disable/enable the account.
Password reset and disable invalidate existing sessions.
Regular users can only access their own cloud links, settings and snapshots.
Passwords are stored as salted scrypt hashes, not plaintext.
Admin credentials from environment variables create the account only if it
is absent; changing the environment password does not reset an existing admin.
Use Change your password while logged in to change the admin's password.

CONNECT GOLOGIN
1. Copy the API token from the GoLogin account you want to use:
   https://app.gologin.com/personalArea/Token
2. In Connect an account, enter a label, paste the token and Save account.
3. Click Load profiles. Use the filter and page buttons, or enter a profile ID.
4. Close that profile in the regular GoLogin app first.
5. Click Open & collect in this panel. Browse in the window it opens.
6. The first SDK launch may download Orbita and can take several minutes.

Changing GoLogin accounts:
- Click Add new, enter a new label and that account's token, then Save account.
- Select the desired account in the dropdown and Load profiles.
- Switching login in GoLogin itself does not switch this panel's token.
- Use Edit token to replace an expired token for the SAME account.
- GoLogin API tokens are kept encrypted on the local PC, not uploaded to cloud.

SET THE MAIN WEBPAGE
1. Enter the final URL of the webpage containing your reward links.
2. Use * for changing parts. For example https://www.linkedin.com/your-page*
   also matches query strings. A URL without * matches the full URL exactly.
3. Leave Minimum decoded links at 4 for your four-link page.
   Change it if a different number is expected. This is a MINIMUM, not a cap.
4. Save settings with Enable automatic capture checked.
5. Open that page in a profile launched through this panel.
6. Preview decoded links lets you check what matches without exporting.

The collector reads all matching reward anchors in the MAIN document. It does
not auto-scroll, click buttons, enter iframes or inspect closed shadow roots.
Links must exist in the page HTML with their URL in an anchor's href attribute.
The source webpage itself has not been supplied, so confirm Preview on your
real page. If that page hides links until a button is clicked, browse normally
until the links appear. The given long-link formats decode without visiting them.

TIMING AND NOTIFICATIONS
- Page navigation and DOM changes trigger checks; a one-second fallback checks
  pages that are already open or newly created.
- Target: capture, decode and save within 2–3 seconds after the matching links
  exist in the main document. This is not a hard guarantee for every PC/site.
- Every matching link is saved even before the configured minimum is reached.
- The green success popup waits for the minimum (default 4). Monitored profiles
  show progress such as 3/4 while fewer links are present.
- On Windows a custom desktop popup appears at the bottom-right of the primary
  screen, above the taskbar, after local database save. It does not require
  browser notification permission and does not intentionally take keyboard focus.
- The in-page popup remains as a fallback. Other operating systems get this
  in-page fallback; the desktop popup is Windows-specific.
- The message confirms LOCAL capture/decoding. Check cloud status before
  treating those links as protected from PC loss. Cloud sync runs independently.
- Existing links are deduplicated per account/profile/rule and decoded URL.
  Cloud deduplication is per panel user/profile/decoded URL.

EXPORTS / INDIAN DATES
- Export TXT prepares a text file with one complete decoded URL per line.
- Filename example: Decoded_Links_2026-10-25.txt (date uses Asia/Kolkata).
- Downloads with the same filename may get a browser-added number.
- The default view is New / unexported. After preparing a TXT export, those
  records move to Exported history. Nothing is deleted automatically.
- Export history retains the exact URLs in each TXT snapshot for repeat downloads.
- A prepared export does not prove your browser successfully wrote the download;
  if the file was blocked/lost, use Download again.
- Select All links to include exported records in another export.
- Search and status filters apply to exports. Cloud exports support up to
  10,000 matching records and 8 MiB of URL text per snapshot; narrow the search
  for larger datasets. Local TXT snapshots also have an 8 MiB content limit.
- Each TXT contains unique URL lines even if several profiles captured the
  same final URL. The panel's rows retain the individual profile history.
- Local CSV/JSON exports are still available as additional raw data exports;
  the New/Exported workflow is tied to TXT snapshots.

PC RESET / DATA SAFETY
When logged in, captures and locally prepared TXT export snapshots are queued
for upload to MongoDB. Only acknowledged cloud data survives deletion of the
local cache. Check the cloud status and Cloud history before resetting a PC.
After a reset, reinstall, log in and open Cloud history to retrieve synced links.
Re-enter local GoLogin API tokens on the new installation.
Cloud storage still needs capacity monitoring and independent backups.
Do not delete your Atlas database or assume cloud storage cannot lose data.

LOCAL FILES / USER SEPARATION
The data folder contains the local database, caches, encrypted GoLogin tokens
and the cloud session. Each panel user/server pair gets a separate cache under
its own generated subdirectory. Do not delete this folder while updating.
Existing v1 local data remains in the original local-mode database; it is not
automatically assigned/uploaded to a new panel user. Log out to inspect it.
Use an export from the v1/local view if you need a portable copy of older data.
Panel login protects CLOUD access; a person with administrator access to the
Windows PC can still inspect local files. Use separate Windows accounts on
shared PCs if local privacy is required. Only authenticated backend requests
can read/write another PC's cloud data; client-supplied owner IDs are ignored
for capture uploads and access to other users is restricted to admin roles.

STOP SAFELY
1. Click Stop & sync for each open profile. Wait until each shows closed.
2. Check cloud status; wait until queued uploads and snapshots finish syncing.
3. Click Exit app, then close the command window.
Do not force-close the command window while a profile is running or syncing.
If GoLogin profile upload fails, the session stays in error for a sync retry.

TROUBLESHOOTING
- No links? Confirm the final main-page URL, wildcard and enabled setting.
- Success popup missing? Check the minimum count and Monitored profiles status.
- Demo works but real page doesn't? Use Preview. Links in a frame or buttons
  without href need an adapter even though the wrapper itself can be decoded.
- Cloud history empty? Check the logged-in panel user, view filter and sync status.
- Cloud user switched? Stop all profiles before logging out or signing in again.
- Login expired? Stop profiles and sign in again using the same user to resume
  that user's local queue. Do not switch users to upload another user's queue.
- Wrong profile account? Select the right GoLogin account and Load profiles.
- Atlas connection error? Read DEPLOY_RAILWAY.txt and check network access.
- Port in use? The app may already be running at http://127.0.0.1:8765.
- Never share your MongoDB connection password, GoLogin tokens or panel password.

DEVELOPERS / VERIFICATION
Local app: npm ci; npm start. Requires Node 24.x.
Logic/API tests: npm test.
Optional Chromium browser test: npm run test:browser (Chrome/Edge installed).
Cloud backend: cd cloud; npm ci; npm start with the variables in the example.
Root railway.json and cloud/Dockerfile build only the cloud backend dependency
set. The GoLogin SDK/browser is NOT installed or launched on Railway.
See TEST_RESULTS.txt for verified behavior and untested deployment/Windows limits.
