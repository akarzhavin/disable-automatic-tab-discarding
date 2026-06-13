/** Shared data model for settings (storage.sync) and stats (storage.local). */

export type ProtectionMode = "exclude" | "whitelist";
export type ThemePref = "auto" | "light" | "dark";

/** User settings — small, synced across devices via chrome.storage.sync. */
export interface Settings {
  /** Master switch. When false, nothing is protected. */
  enabled: boolean;
  /** "exclude" = protect all but the excluded list; "whitelist" = protect only the listed sites. */
  mode: ProtectionMode;
  /** Domains that may be discarded (used in "exclude" mode). */
  excludedDomains: string[];
  /** Domains to keep alive (used in "whitelist" mode). */
  whitelistedDomains: string[];
  /** UI theme preference. */
  theme: ThemePref;
}

/** Lifetime counters — local only, can grow, stored in chrome.storage.local. */
export interface Stats {
  /** Number of times a tab was set to autoDiscardable:false. */
  protectOps: number;
  /** Number of times a tab was observed being discarded by Chrome. */
  discardEventsObserved: number;
  /** Epoch ms when the extension was installed. */
  installedAt: number;
}

/** Per-tab manual override: takes priority over domain rules while the tab lives. */
export type TabOverride = "protect" | "discard";
/**
 * A live override plus the URL key it's bound to. The key lets us re-point the
 * remembered activation when a tab navigates within itself, so an in-tab
 * navigation moves the memory instead of leaving an orphaned ghost behind.
 */
export interface TabOverrideEntry {
  value: TabOverride;
  /** activationKey of the URL this override was set/restored on (null if unkeyable). */
  key: string | null;
}
/** tabId → override entry. Stored in chrome.storage.session (tab ids die with the browser). */
export type TabOverrides = Record<number, TabOverrideEntry>;

/**
 * A remembered per-tab decision, keyed by URL so it survives close/reopen and
 * browser restarts. `expiresAt` is re-anchored each time the tab is opened.
 */
export interface UrlActivation {
  value: TabOverride;
  /** Epoch ms after which this memory is dropped. */
  expiresAt: number;
  /** Last known page title, for showing the tab while it's closed. */
  title?: string;
}
/** urlKey → activation. Stored in chrome.storage.local (durable, with a TTL). */
export type UrlActivations = Record<string, UrlActivation>;

export const SETTINGS_KEY = "settings";
export const STATS_KEY = "stats";
export const OVERRIDES_KEY = "tabOverrides";
export const ACTIVATIONS_KEY = "urlActivations";

/** How long a remembered per-tab activation lives, measured from the last open. */
export const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Upper bound on a domain list to stay well under storage.sync quotas. */
export const MAX_DOMAINS = 200;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  // Opt-in by default: protect nothing until the user picks sites (or flips a
  // per-tab switch). "Protect everything" is available but too aggressive to ship on.
  mode: "whitelist",
  excludedDomains: [],
  whitelistedDomains: [],
  theme: "auto",
};

export const DEFAULT_STATS: Stats = {
  protectOps: 0,
  discardEventsObserved: 0,
  installedAt: 0,
};
