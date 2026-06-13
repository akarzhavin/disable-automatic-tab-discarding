# Privacy Policy — Keep Tabs Alive

**Effective date:** 13 June 2026

Keep Tabs Alive ("the extension") is designed to be private by default. This
policy explains exactly what the extension does and does not do with your data.

## Summary

- **No data is collected.** The extension has no analytics, no telemetry and no
  tracking of any kind.
- **No data leaves your browser.** The extension makes no network requests and
  communicates with no external servers.
- **No accounts, no ads, no third parties.** Nothing is shared with or sold to
  anyone.

## What the extension accesses

To do its job — stopping Chrome from automatically discarding your tabs — the
extension uses two Chrome permissions:

- **`tabs`** — lets the extension see your open tabs (their URL, title and
  favicon) so it can:
  - match a tab against your per-site rules,
  - show the searchable tab list on the settings page, and
  - mark the right tabs as non-discardable
    (`autoDiscardable = false`).

  This information is read and used **locally, in your browser, in real time**.
  It is never recorded to disk, transmitted, or shared.

- **`storage`** — lets the extension save your own settings on your device:
  - your protection mode and master on/off state,
  - your per-site rules (excluded / whitelisted domains),
  - temporary per-tab overrides, and
  - usage counters (tabs protected, protect operations, discards observed).

## Where your data is stored

All of the above is stored only in Chrome's own extension storage on your
device:

- **`chrome.storage.sync`** — your settings. If you have Chrome Sync enabled,
  Chrome itself may sync these settings across your signed-in devices, under
  Google's control and privacy terms. The extension does not operate or have
  access to any separate server.
- **`chrome.storage.local`** — your usage statistics.
- **`chrome.storage.session`** — temporary per-tab overrides, cleared when the
  browser session ends.

You can erase everything the extension stores at any time by removing the
extension, or by using the **Reset** control for statistics on the settings
page.

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
