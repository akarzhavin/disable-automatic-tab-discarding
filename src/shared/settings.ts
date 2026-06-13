/** Load/save user settings from chrome.storage.sync, merged over defaults. */

import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from "./types.js";

/** Read settings, filling any missing fields from defaults (forward-compatible). */
export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Merge a partial patch into stored settings and persist it. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Seed defaults on first install if nothing is stored yet. */
export async function ensureSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  if (raw[SETTINGS_KEY]) return raw[SETTINGS_KEY] as Settings;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

/** Fire `cb` whenever the settings object changes in storage.sync. */
export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return;
    cb({ ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Partial<Settings>) });
  });
}
