#!/bin/bash
# inbox — global capture.
# Copies the current selection, asks for an optional note, POSTs to the local server.
# Bound to a hotkey via a macOS Quick Action (see scripts/install-shortcut.sh).

PORT="${PORT:-3737}"
ENDPOINT="http://localhost:${PORT}/capture"

notify() { osascript -e "display notification \"$1\" with title \"inbox\"" >/dev/null 2>&1; }

# 1. Grab the selection. Copying is more reliable across apps than reading the
#    a11y selection, and works in browsers, PDFs, terminals and native apps alike.
PREV_CLIP="$(pbpaste 2>/dev/null)"
osascript -e 'tell application "System Events" to keystroke "c" using command down' >/dev/null 2>&1
sleep 0.35
TEXT="$(pbpaste 2>/dev/null)"

# If the clipboard did not change, nothing was selected — fall back to whatever is on it.
if [ -z "$TEXT" ]; then
  notify "Nothing selected"
  exit 0
fi

# 2. Front app, for provenance.
APP="$(osascript -e 'tell application "System Events" to name of first application process whose frontmost is true' 2>/dev/null)"

# 3. Try to get the URL if we're in a browser.
URL=""
case "$APP" in
  Safari)
    URL="$(osascript -e 'tell application "Safari" to return URL of front document' 2>/dev/null)" ;;
  "Google Chrome"|Chrome|Arc|Brave*)
    URL="$(osascript -e "tell application \"$APP\" to return URL of active tab of front window" 2>/dev/null)" ;;
esac

# 4. Optional note. Cancel here cancels the whole capture.
NOTE="$(osascript -e 'try
  set r to display dialog "Note for the vault (optional)" default answer "" with title "inbox" buttons {"Cancel","Capture"} default button "Capture"
  return text returned of r
on error
  return "__CANCELLED__"
end try' 2>/dev/null)"

if [ "$NOTE" = "__CANCELLED__" ]; then
  [ -n "$PREV_CLIP" ] && printf '%s' "$PREV_CLIP" | pbcopy
  exit 0
fi

# 5. Send it. jq builds the JSON so quotes and newlines in the selection survive.
BODY="$(jq -nc --arg t "$TEXT" --arg n "$NOTE" --arg u "$URL" --arg a "$APP" \
  '{text:$t, note:$n, sourceUrl:$u, sourceApp:$a}' 2>/dev/null)"

if [ -z "$BODY" ]; then
  # jq missing — fall back to python3, which is always present on macOS
  BODY="$(TEXT="$TEXT" NOTE="$NOTE" URL="$URL" APP="$APP" python3 -c \
    'import json,os;print(json.dumps({"text":os.environ["TEXT"],"note":os.environ["NOTE"],"sourceUrl":os.environ["URL"],"sourceApp":os.environ["APP"]}))')"
fi

notify "Filing…"
RESP="$(curl -sS -m 300 -X POST "$ENDPOINT" -H 'content-type: application/json' -d "$BODY" 2>&1)"

# 6. Restore whatever was on the clipboard before we hijacked it.
[ -n "$PREV_CLIP" ] && printf '%s' "$PREV_CLIP" | pbcopy

FILED="$(printf '%s' "$RESP" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print("Filed → " + ", ".join(d.get("changedFiles") or ["(no change)"]) if d.get("ok") else "Failed: " + str(d.get("error"))[:80])
except Exception:
    print("Server unreachable")' 2>/dev/null)"

notify "$FILED"
