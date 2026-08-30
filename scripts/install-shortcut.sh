#!/bin/bash
# Installs "Capture to inbox" as a macOS Quick Action so it can be bound to a
# global hotkey in System Settings > Keyboard > Keyboard Shortcuts > Services.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="$HOME/Library/Services/Capture to inbox.workflow"

chmod +x "$REPO/scripts/capture.sh"
rm -rf "$SERVICE"
mkdir -p "$SERVICE/Contents"

python3 - "$SERVICE" "$REPO" <<'PY'
import plistlib, sys, uuid, os

service, repo = sys.argv[1], sys.argv[2]
script = '#!/bin/bash\nexec "%s/scripts/capture.sh"\n' % repo

action = {
    'action': {
        'AMAccepts': {'Container': 'List', 'Optional': True, 'Types': ['com.apple.cocoa.string']},
        'AMActionVersion': '2.0.3',
        'AMApplication': ['Automator'],
        'AMParameterProperties': {
            'COMMAND_STRING': {}, 'CheckedForUserDefaultShell': {},
            'inputMethod': {}, 'shell': {}, 'source': {},
        },
        'AMProvides': {'Container': 'List', 'Types': ['com.apple.cocoa.string']},
        'ActionBundlePath': '/System/Library/Automator/Run Shell Script.action',
        'ActionName': 'Run Shell Script',
        'ActionParameters': {
            'COMMAND_STRING': script,
            'CheckedForUserDefaultShell': True,
            'inputMethod': 0,
            'shell': '/bin/bash',
            'source': '',
        },
        'BundleIdentifier': 'com.apple.RunShellScript',
        'CFBundleVersion': '2.0.3',
        'CanShowSelectedItemsWhenRun': False,
        'CanShowWhenRun': True,
        'Category': ['AMCategoryUtilities'],
        'Class Name': 'RunShellScriptAction',
        'InputUUID': str(uuid.uuid4()),
        'Keywords': ['Shell', 'Script', 'Command', 'Run', 'Unix'],
        'OutputUUID': str(uuid.uuid4()),
        'UUID': str(uuid.uuid4()),
        'UnlocalizedApplications': ['Automator'],
        'arguments': {},
        'isViewVisible': 1,
        'location': '309.000000:253.000000',
        'nibPath': '/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib',
    },
    'isViewVisible': 1,
}

wflow = {
    'AMApplicationBuild': '523',
    'AMApplicationVersion': '2.10',
    'AMDocumentVersion': '2',
    'actions': [action],
    'connectors': {},
    'workflowMetaData': {
        'applicationBundleIDsByPath': {},
        'applicationPaths': [],
        'inputTypeIdentifier': 'com.apple.Automator.nothing',
        'outputTypeIdentifier': 'com.apple.Automator.nothing',
        'presentationMode': 11,
        'processesInput': 0,
        'serviceInputTypeIdentifier': 'com.apple.Automator.nothing',
        'serviceOutputTypeIdentifier': 'com.apple.Automator.nothing',
        'serviceProcessesInput': 0,
        'useAutomaticInputType': 0,
        'workflowTypeIdentifier': 'com.apple.Automator.servicesMenu',
    },
}

info = {
    'NSServices': [
        {
            'NSMenuItem': {'default': 'Capture to inbox'},
            'NSMessage': 'runWorkflowAsService',
            'NSSendTypes': [],
            'NSSendFileTypes': [],
        }
    ],
}

contents = os.path.join(service, 'Contents')
os.makedirs(contents, exist_ok=True)
with open(os.path.join(contents, 'document.wflow'), 'wb') as f:
    plistlib.dump(wflow, f)
with open(os.path.join(contents, 'Info.plist'), 'wb') as f:
    plistlib.dump(info, f)
print('installed:', service)
PY

# Nudge the Services menu to rescan.
/System/Library/CoreServices/pbs -flush 2>/dev/null || true

cat <<EOF

  Installed "Capture to inbox".

  Bind a hotkey:
    System Settings > Keyboard > Keyboard Shortcuts > Services
      > General > "Capture to inbox"  ->  set to  Cmd-Shift-K

  First run will ask for Accessibility permission (it sends Cmd-C).
  Grant it to whatever it names, then try again.

  Test without a hotkey:
    ./scripts/capture.sh

EOF
