LINK GRABBER WEB v6.6.1 / COMBINED EXTENSION v1.11.1
11 November 2026 (IST)

PRIVATE WORKFLOW v1.7.7 MERGE
The Career Redeem button uses its stable data attribute inside the form, with
plan classes and the captured form/role/text selector as fallbacks. Minor offer
wording and generated Ember ID changes do not affect its primary match.
Redeem/Individual controls can be found on the main page while the older survey
iframe remains present. A scoped probe chooses the correct page/frame; disabled,
busy, covered or ambiguous controls still wait for one ready target.

Grab Links, private user connections, admin-managed workflow URLs/alternates,
dynamic service configuration and notification colors remain included.
Console capture scripts and service catalogs do not need regeneration for this
workflow-only update. The existing release notice announces the new extension.

APPLY THE UPDATE
1. Replace the GitHub project files and redeploy Railway. Hard refresh the panel.
2. Stop any active workflow. Download your own updated extension from the panel.
3. Replace the files in the SAME installed extension folder, then press Reload
   on chrome://extensions (or the browser's extensions page).
4. Refresh already-open website tabs. The extension should show v1.11.1.
5. Start a fresh workflow. Older workflow revision snapshots stop on upgrade.

No new env variables, database migration or active-script regeneration required.
Keep the current MongoDB database and SCRIPT_ENCRYPTION_KEY.

Earlier extension notes follow:

DYNAMIC CAPTURE SERVICES - v1.11.0
31 October 2026 (IST)
Grab Links fetches the current admin-managed service catalog on every capture.
The admin can add/remove/restore services without another extension download.
Dynamic rules check domain, exact path and required URL parameter names. The
server validates matches again before saving. Existing workflow actions, Trial
alternates, admin workflow URLs and capture notification colors are unchanged.

PRIVATE WORKFLOW RUNNER v1.11.1 - PERSONAL LINK GRABBER
30 October 2026 (IST)

Buttons: Trial | Grab Links | Cancel & Refund.
Workflow core merged from supplied v1.7.6. Checkout readiness/error handling and
all captured Trial and Cancel & Refund actions are preserved.

INSTALLATION / UPDATE
Download your own ZIP from the web panel. Keep it private: it contains your
capture connection. Extract to a permanent folder, enable Developer mode in
chrome://extensions and Load unpacked. To update, replace files in the same
installed folder and press Reload. Refresh old site tabs before the next run.
Local timing/pincode preferences remain available. See CAPTURE_SETUP.txt in
your personalized download. Console script capture remains a separate option.

ADMIN-MANAGED URLS
Only the web-panel admin configures Trial primary/alternate pages and the two
Cancel & Refund URLs. Installed personalized extensions refresh them on every
fresh workflow start. Local values cannot override current admin settings.
The alternate-list setup is hidden in personalized extension Settings. Other
preferences, such as timing/pincode, remain local. Reset Settings does not reset
the web admin configuration. Active runs keep their initial settings snapshot.

TRIAL
An open primary/explicit alternate starting page in the current window is
reused without a reload, preferring the selected matching tab. Otherwise only
the primary opens in the current tab. HTTP and in-page redirects can reach a
listed alternate. The first captured control must be uniquely ready before an
action. Origin/path/query match exactly, allowing a single trailing slash; a
configured fragment must also match. Child paths and changed queries are not
accepted automatically. Alternate URLs are not visited sequentially.

CANCEL & REFUND
Starts at its own URL 1; opens URL 2 after Confirm cancel. Trial alternates never
apply to this workflow. Both workflows can start fresh directly after Stop.
A run retains checkpoints across page navigation, pause and worker recreation.
Only a recognized ready control is acted on. A submitted final payment click is
not repeated automatically. Persistent checkout errors stop the workflow.

GRAB LINKS
Uses the current admin capture page/services, independently of workflow URLs.
It reuses a matching page or opens the capture page, decodes selected reward
links and saves them to the connected account. Success is shown only after the
database confirms the save. Green = success, amber = warning, red = error,
blue = information. Page toasts dismiss automatically; popup keeps latest status.
Revoked/reset/disabled account connections fail; explicitly regenerate your
script in the panel then download the new personal extension to reconnect.
