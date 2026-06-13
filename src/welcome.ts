/** First-run welcome page — applies the saved theme and eases into settings. */

import { localizePage } from "./shared/i18n.js";
import { navigateWithFade } from "./shared/pagefx.js";
import { getSettings } from "./shared/settings.js";
import { applyTheme } from "./shared/theme.js";

localizePage();

const openOptions = document.getElementById("openOptions");
openOptions?.addEventListener("click", () => navigateWithFade("options.html"));

void getSettings().then((s) => applyTheme(s.theme));
