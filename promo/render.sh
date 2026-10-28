#!/usr/bin/env bash
# Thin wrapper → renders via Playwright's bundled Chromium (render.mjs).
#
# IMPORTANT: rendering goes through Playwright's OWN "Chrome for Testing" with a
# throwaway profile. It never launches or touches your installed Google Chrome.
# (An earlier version of this script drove /Applications/Google Chrome directly,
# which could collide with your running browser — that approach is gone.)
#
#   ./render.sh                 # all locales
#   ./render.sh ru de fr        # only the given locales
#   ./render.sh -j 4 ru de      # cap parallelism at 4 concurrent pages
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/render.mjs" "$@"
