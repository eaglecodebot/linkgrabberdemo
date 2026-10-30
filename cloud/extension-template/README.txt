PRIVATE WORKFLOW RUNNER v1.10.0 - PERSONAL LINK GRABBER
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
