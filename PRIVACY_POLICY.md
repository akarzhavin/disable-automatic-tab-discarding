# Privacy Policy — Keep Tabs Alive

**Effective date:** 28 October 2026

Keep Tabs Alive ("the extension") is designed to be private by default. This
policy explains exactly what the extension does and does not do with your data.

## Summary

- **No data is collected.** The extension has no analytics, no telemetry and no
  tracking of any kind.
- **No data leaves your browser.** The extension makes no network requests and
  communicates with no external servers.
- **No accounts, no ads, no third parties.** Nothing is shared with or sold to
  anyone.
- **Keep running never records your tab.** The optional Keep running feature
  opens a capture of a tab you choose, but the picture is never read, recorded,
  stored or transmitted.

## What the extension accesses

The extension does two things: it stops Chrome from automatically discarding
(unloading) your tabs, and — only for tabs you explicitly switch on — it stops
Chrome from slowing those tabs down while they are hidden ("Keep running"). To do
this it uses these Chrome permissions:

- **`tabs`** — lets the extension see your open tabs (their URL, title and
  favicon) so it can:
  - match a tab against your per-site rules,
  - show the searchable tab list on the settings page and the list of protected
    and kept-running tabs in the popup,
  - switch to a tab when you click it in those lists, and
  - mark the right tabs as non-discardable (`autoDiscardable = false`).

  This information is used **locally, in your browser**. The only tab details
  the extension keeps are the address and title of tabs you have personally
  switched on or off (see "Where your data is stored"); nothing is ever
  transmitted or shared.

- **`storage`** — lets the extension save your own settings and state on your
  device:
  - your protection mode and master on/off state,
  - your per-site rules (excluded / whitelisted domains),
  - your per-tab choices, remembered by page address and title for 7 days so
    that a reopened tab keeps the same setting,
  - which tabs are currently kept running and their auto-off times,
  - your preferred auto-off delay and the fact that you have acknowledged the
    Keep running notice,
  - whether you have already seen the guided tour, and
  - local usage counters (for example, how many tabs have been protected).

- **`tabCapture`, `activeTab` and `offscreen`** — power the optional **Keep
  running** switch. When you turn it on for a tab, the extension opens a capture
  of that tab and keeps it open in a hidden offscreen document, which tells
  Chrome the tab is in use so it is not slowed down while hidden. Chrome shows
  its screen-sharing indicator on that tab while this is on. **The captured
  picture is never read, recorded, stored or transmitted** — only the open
  capture matters, and no audio is captured. It happens only for tabs you switch
  on yourself, and stops when you switch it off, when the auto-off timer you
  chose runs out, or when you close the tab.

- **`scripting`** — used together with `activeTab` only to show a small
  "this tab is kept running" strip, with an Off button, on the tab you just
  switched on. It is never injected into any other tab, and it does not read,
  change or collect anything from the page.

The extension requests no access to websites' content (no host permissions).

## Where your data is stored

All of the above is stored only in Chrome's own extension storage on your
device:

- **`chrome.storage.sync`** — your settings and per-site rules. If you have
  Chrome Sync enabled, Chrome itself may sync these settings across your
  signed-in devices, under Google's control and privacy terms. The extension
  does not operate or have access to any separate server.
- **`chrome.storage.local`** — your per-tab choices (page address and title,
  removed automatically after 7 days without use), your Keep running
  preferences, the guided-tour flag and the usage counters.
- **`chrome.storage.session`** — temporary per-tab overrides and the list of
  tabs currently kept running with their auto-off times, cleared when the
  browser session ends.

You can erase everything the extension stores at any time by removing the
extension.

## Data sharing and selling

The extension does **not** collect, transmit, share, or sell any personal or
usage data. There is no remote code and no third-party service involved.

## Children's privacy

The extension collects no data from anyone, including children.

## Changes to this policy

If this policy changes, the updated version will be published in the extension's
repository and listing, with a revised effective date.

## Contact

Questions about this policy: **aliaksandr.karzhavin@gmail.com**
