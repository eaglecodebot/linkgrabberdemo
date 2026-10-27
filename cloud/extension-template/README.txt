PRIVATE WORKFLOW RUNNER v1.9.1 — PERSONAL LINK GRABBER
Buttons: Trial | Grab Links | Cancel & Refund.
See CAPTURE_SETUP.txt in the personalized download for capture installation.
The source template is personalized by the Link Grabber web panel when each user
clicks Download my extension. Do not share a personalized ZIP between accounts.
Main capture URL/services are controlled by the web-panel admin; trial/cancel
workflow URLs are managed in the web admin panel and refresh before each run. Grab Links does not perform payment,
trial, cancellation or refund clicks; use the corresponding workflow button.

The following instructions describe the existing Trial/Cancel & Refund workflows:

PRIVATE WORKFLOW RUNNER — CHROME / EDGE — VERSION 1.7.3

NEW IN THIS VERSION

- After Stop, click Trial or Cancel & Refund directly to begin a fresh run.
  There is no separate Start button. The stopped message names both buttons,
  including when reopening a run stopped in an older version.
- Both workflow buttons remain clickable when idle/stopped. A missing URL
  produces a clear setup message. If the same previous workflow has a saved
  run URL and its current URL fields are blank, that URL is reused with the
  current action definitions. New configured URLs always take precedence;
  another workflow's URLs are not borrowed.

RETAINED FEATURES

- After Individual, action 7 accepts Confirm, Submit, or Redeem 1 month for
  ₹0. It uses the captured plan button or the Individual dialog first and
  waits if that control is disabled/busy or more than one variant matches.

- Workflow buttons are now named Trial (Step 1) and Cancel & Refund (Step 2).

- Both workflow buttons reuse an already-open matching starting page without
  reloading it. If none is open, your current tab navigates to the configured
  URL, including when you start from New Tab, about:blank or another website.
- Step 1 now has action 14: wait for the QR page after the last click, wait
  for its generated image to load, scroll it to the middle, then stop with
  "QR code ready". The QR image is shown on its original page and not clicked.
- The Individual continuation must be unique, enabled, stable and uncovered;
  the Individual selection is checked before the click.
- The final Start my free trial button remains action 13, after Monthly,
  UPI, QR code, pincode and Continue. These are separate actions.
- The existing two-workflow features remain available:
- Separate Trial and Cancel & Refund buttons. Only one workflow runs at a
  time; each starts manually and the popup closes after a successful start.
- Step 1 keeps the existing 13 actions, scrolling and tooltip fixes before
  the new QR display action.
- Step 2 opens URL 1 in your current website tab. After Confirm cancel
  (action 6 in your picker export) changes the cancellation screen, it opens
  URL 2 in that same tab, then clicks Submit and Contact LinkedIn Support.
- Two consecutive Continue to cancel screens are distinguished by a screen
  transition. A generated component key changing alone is not enough.
- 50 additional Delhi pincodes: 56 unique default entries in total. Existing
  browser settings using the original six-entry default expand automatically.
  Custom lists and your private URLs are preserved.

UPDATE AN EXISTING INSTALLATION

1. Stop any old run. If private URLs exist only in workflow.json, keep a
   private copy before replacing files. This package ships URL fields blank.
2. Replace files in the SAME extracted extension folder and reload the
   existing extension at chrome://extensions or edge://extensions.
   Do not install each version as a separate copy. Retaining the installation
   also retains browser-saved settings and website permission grants.
3. Refresh old website tabs to clear scripts from the previous build.
4. The popup should show v1.7.3. Browser-saved settings stay available. If
   your URLs were stored in workflow.json, copy just those three URL values
   into the new file. Keep this version's updated action definitions.
5. Press Trial or Cancel & Refund from any tab. An existing matching
   starting page is preferred; otherwise the current tab opens the configured
   URL. Step 2 later opens URL 2 after Confirm cancel in that same tab.

The saved actions match v1.7.2, so its configured workflow.json can be kept.
Older workflow revisions are stopped on upgrade. Click Trial or Cancel &
Refund for a fresh run. The workflows do not start one another automatically.

FIRST INSTALLATION

1. Extract the whole ZIP to a normal folder on your PC.
2. Open chrome://extensions (Chrome) or edge://extensions (Edge).
3. Enable Developer mode. Choose Load unpacked and select the folder named
   private-workflow-extension containing manifest.json.
4. Ask the web administrator to set the three workflow URLs. Open Settings for
   your other preferences. In personalized v1.9+ builds, workflow URLs are read-only. You can configure
   Step 1 alone, Step 2 alone, or both. Step 2 requires both of its URLs.
5. Log in to the website in this browser profile. Choose the workflow's
   button and grant the requested website access if necessary.

URLS AND SETTINGS

Settings stores your URLs in this browser profile. They are not sent to a
server operated by this extension. You do not need to share them with anyone.

Alternatively, set these fields in workflow.json:

  "startUrl": "",          Step 1 starting page
  "step2StartUrl": "",     Step 2 URL 1, opened at the beginning
  "step2SecondUrl": "",    Step 2 URL 2, opened after Confirm cancel

Keep JSON quotation marks/commas valid. After editing workflow.json, reload
the extension. Browser-saved values override that file; use Settings to update
those values. Reload defaults from workflow.json replaces saved settings,
including URLs, so use it only when you intend to return to file defaults.

Other websites used by the workflow is optional and shared by both workflows.
Step 2's two URL origins are included in its initial permission request. A new
unlisted redirect/embedded origin pauses the run for explicit access. Open the
popup and choose Allow website & continue; its checkpoint is preserved.

STEP 1 — EXISTING ACTIONS

1. Open the Access exclusive tools & insights / Try Premium for ₹0 link.
2. Check Other in the captured survey frame or direct-page survey layout.
3. Dismiss the captured chat tooltip if present, then click Next.
4. Click Learn more about Career.
5. Click the form's Redeem 1 month for ₹0 button.
6. Select Individual.
7. Click the available Confirm / Submit / Redeem 1 month for ₹0 button for
   the selected Individual plan.
8. Select Monthly.
9. Open UPI.
10. Select QR code.
11. Type the saved pincode in the captured Pin code field.
12. Click Continue and wait for checkout to settle.
13. After at least 3 seconds, wait for the final CTA to stay enabled/stable
    for at least 500 ms, then click it once.
14. Wait for navigation to the generated UPI QR page and a loaded QR image.
    Scroll the image to the middle of the screen, then stop.

Both workflows prefer an already-open matching starting page in this window.
Origin, path and query must match; a trailing slash is tolerated and a hash
must match only if configured. A match is activated without reloading. With
no match, the selected/active tab navigates to the configured starting URL.
If no tab is available, one is created. Later actions may navigate or refresh.

The QR action uses the captured image attribute or its specific class/alt;
it never substitutes an unrelated image. It waits for the image data to load
and for a stable, uncovered view. A small empty spacer can be added below a
QR at the bottom of the document so the browser can scroll it to the center.
It contains no QR data and disappears when the page navigates. The original
QR image is not copied or saved. Once positioned, monitoring and scrolling
stop. If the QR does not appear, the wait times out without repeating the
preceding trial click. Pause/refresh/worker restart preserve that checkpoint.

STEP 2 — NEW ACTIONS

Before action 1, Cancel & Refund reuses an existing URL 1 tab or opens URL 1 in
the selected tab.

1. Dismiss chat tooltip if present; continue if it is absent.
   It is checked again before Premium Career if it appears later during load.
2. Open the captured Premium Career subscription link.
3. Click Cancel subscription.
4. Click Continue to cancel on the first screen.
5. Wait for that screen to change, then click Continue to cancel again.
6. Click Confirm cancel. Wait for that screen/control to change or disappear,
   with a minimum settling interval, before proceeding.
7. Open URL 2 in the same tab. This extra navigation action corresponds to
   your instruction to change URLs after picker action 6.
8. Wait for the captured Submit control, then click it.
9. Click Contact LinkedIn Support in the same tab, then stop.

The export contains four Premium Career text matches. This build uses the
captured unique location plus its data attribute, and waits for one clear
match. A changed account layout may require an updated capture.

The two Continue controls have identical text. The runner stores a hash of
bounded nearby screen text to confirm a transition before the second click;
it does not store that screen text in its checkpoint or diagnostic export.
A generated component-key change alone does not count as a new screen.

The URL 2 navigation is checkpointed. A pause, refresh or worker restart does
not restart cancellation from the beginning. If cancellation does not produce
an observable screen/control transition, the run waits and eventually times
out for inspection. It does not keep clicking Confirm cancel.

Step 2's final support link opens a page; it does not compose/send a support
message. A click acknowledgement does not confirm cancellation or a refund
was approved by the website. Check the site's result.

READINESS AND RECOVERY

The runner waits for DOM readiness, one matching enabled control, a stable
position and an uncovered hit point. It scrolls controls into view, including
nested scrolling areas. If a control mounts only after scrolling, a bounded
search checks the relevant scroll containers in small increments.

The captured chat-tooltip close button is recognized by its stable class or
accessible label, even if its text is hidden. Its captured page, the current
survey frame and ancestors can be checked. Parent overlays also block a
close button in a child frame. Unrelated close buttons are not chosen.

Choices/text are verified after events are handled. Selected prerequisites
can be read while temporarily disabled/busy. Actual clicks/typing still wait
for enabled controls. A control disabled or replaced during focus releases
an unexecuted claim and waits again.

The stability default is 200 ms. Maximum wait per action (120 seconds by
default) is a timeout, not a fixed delay added to each action. Server response
times remain controlled by the website.

Action checkpoints are saved before dispatch. If navigation interrupts an
acknowledgement, the next page looks for evidence of progress. An uncertain
click is not blindly repeated. An uncertain final click cannot be retried
through the Retry button; inspect the website before starting anything again.

CONTROLS

Trial: Open/reuse its starting page and run its 14-action workflow.
Cancel & Refund: Open URL 1 and begin its cancellation/refund/support workflow.
Pause / Resume: Stop new actions, then continue from the saved action.
Stop: End the current run. Click Trial or Cancel & Refund for a fresh run.
Retry this action: Available after an error; inspect the site first.
Settings: View admin-managed URLs; configure local timing and pincode settings.
Download diagnostics: Export workflow_diagnostics.json with workflow number,
  action, readiness and frame details. URLs and entered values are redacted.

Closing the popup does not stop a run. Keep the browser and workflow tab
open. Visiting a page never starts a run automatically. Reloading/restarting
the extension pauses a compatible run; an outdated workflow revision stops.

PINCODE SETTINGS

Random mode chooses one value per run and reuses it through refreshes, pauses
and retries. Fixed mode is available. The original six default values are
retained, with 50 additional values for 56 total. A custom browser-saved list
is kept; the exact old six-entry default is upgraded automatically.

All 56 default codes were checked against the Government of NCT of Delhi's
District New Delhi STD & PIN Codes directory on 27 October 2026:
https://dmnewdelhi.delhi.gov.in/std-pin-codes/

For real billing, use the pincode belonging to your billing address. The
captured Pin code label handles generated field IDs. Postal fallback requires
explicit postal semantics inside the UPI form; unrelated Zip/reference fields
are avoided. A CSS override is available if the website changes.

PRIVACY / ANOTHER PC / LIMITS

The extension has no analytics, remote server or third-party runtime code.
Settings and progress stay in this browser profile; normal website requests
made by the actions still occur. The element picker remains separate.

To use another PC, copy the extracted folder, load it unpacked, log in and
configure private URLs/settings in that browser. Browser-saved settings and
sessions do not transfer automatically; values in workflow.json do.

Targets use DOM elements, not screen coordinates. Website redesigns,
account/language/offer variations and trusted-input requirements may need
updates. Supported: desktop Chrome/Edge 120+, main documents, captured open
shadow roots, and captured frames after site access is granted. Closed shadow
roots, canvas interfaces, native dialogs and mobile browsers need more work.

See TEST_RESULTS.txt for validation and its limits. Development tests use
Node.js/Playwright. Neither is required to install or use the extension.
