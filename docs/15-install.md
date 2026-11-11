# Installing PiBrowse

## PiBrowse 0.5.5 preview — Apple Silicon Mac

Download [v0.5.5](https://github.com/aronhy/pibrowse/releases/tag/v0.5.5):

1. Open `pibrowse-0.5.5-macos-arm64.dmg` and move **PiBrowse.app** to Applications.
2. Open PiBrowse and choose **Download the browser**. This user-triggered download
   now uses this repository’s `pibrowse-core-0.5.5-macos-arm64.tar.xz`, containing
   the rebuilt PiBrowse Chromium **157.0.8103.39** engine.
3. Verify downloaded files against the release’s `SHA256SUMS.txt` if installing by hand.

The desktop is ad-hoc signed; the core keeps its native linker ad-hoc signature.
Neither has Apple Developer ID signing or notarization. These are preview builds,
and this release does not claim Gatekeeper acceptance. Application updates are
manual; no automatic update signing key is configured. No Windows or Intel Mac
binary is supplied in this release.

For manual core import, use the agent included in the installed application:

```sh
/Applications/PiBrowse.app/Contents/MacOS/fury-agent install-core \
  ~/Downloads/pibrowse-core-0.5.5-macos-arm64.tar.xz
```

Existing agent data remains in `~/Library/Application Support/Fury`. The desktop
keeps the `dev.pibrowse.desktop` application identifier introduced in 0.5.4;
`dev.fury.core`, `FURY_*` settings, command names and prior core leaf names remain
compatible. The native Dock uses the original Chromium icon with stable profile
numbers; internal product labels and marks use PiBrowse.

---


> PiBrowse downloads: [Releases](https://github.com/aronhy/pibrowse/releases). Use the actual filename and signing status listed there; the older version/signing history below describes upstream Fury releases. Older browser-core archives named `fury-core-*` remain upstream compatibility resources from [upstream Releases](https://github.com/furyteamtop/fury-antidetect-browser/releases).
> Compatibility note: `FURY_*` settings, `fury-*` commands, package names and storage paths retain their existing names. Legacy core filenames remain supported; a new macOS core uses `PiBrowse.app/Contents/MacOS/PiBrowse`.

For a person who has not built anything. If you want to build from source, that
is [docs/03](03-chromium-fork.md) and the README; this page assumes you have a
computer and a browser and nothing else.

PiBrowse is **two downloads**, and that is worth understanding before you start,
because otherwise the second one looks like a mistake:

| | what it is | size |
|---|---|---|
| **PiBrowse** | the application: profiles, proxies, personas, teams | ~12 MB |
| **PiBrowse core** | the browser itself — a Chromium fork | 103 MB on macOS, 146 MB on Windows |

They are apart because they move apart. The application changes weekly; the core
changes when Chromium does, every six weeks or so. Bundling them would mean a
100-plus MB download every time a button moved. It also keeps the application's code
signature intact — a core written into a signed bundle breaks its seal, after
which macOS says the application is *damaged*, which sends you looking for a
corrupt download rather than at us.

## macOS

### 1. The application

Download the macOS `.dmg` listed on
[Releases](https://github.com/aronhy/pibrowse/releases). `arch` is `arm64` for
any Apple-silicon Mac (M1 and later) — if you are not sure,  → About This Mac
says which. Intel Macs have no release build yet: the name would be `x86_64`,
and until one is published the way in on an Intel machine is to build it.

Open it and drag **PiBrowse.app** into `/Applications`, the way every other Mac
application is installed.

### 2. The browser core

Open PiBrowse. It says the browser itself is not installed yet and offers
**Download the browser** — press it. That fetches the core for this machine
from the Releases page, about 100 MB, once, and installs it. Nothing runs on a
timer or at startup: the request is made when you press the button and not
otherwise, which is the difference between this and the automatic updates the
project refuses to have (the reasons are at the bottom of this page).

Or by hand: download `fury-core-<version>-macos-<arch>.tar.xz` from
[upstream Releases](https://github.com/furyteamtop/fury-antidetect-browser/releases), then in Terminal:

```bash
/Applications/PiBrowse.app/Contents/MacOS/fury-agent install-core ~/Downloads/fury-core-*.tar.xz
```

The button runs exactly this. It does three things by hand that are easy to get
wrong: it unpacks the bundle preserving the symlinks a macOS framework is built
from, it removes the quarantine flag your browser attached to the download, and
— the step that matters — it **runs the browser once and checks it starts**.
Example output from a compatible legacy upstream core:

```
installed Fury 157.0.8103.39
  /Users/you/Library/Application Support/Fury/core.bundle/Fury.app/Contents/MacOS/Fury
```

A core newly built from this PiBrowse source uses
`core/src/out/<target>.noindex/PiBrowse.app/Contents/MacOS/PiBrowse`. When installed
from a PiBrowse core archive, its path is
`~/Library/Application Support/Fury/core.bundle/PiBrowse.app/Contents/MacOS/PiBrowse`.
The `Fury.app` path above is a legacy compatibility example, not the output path
of a new build.

Ask it at any time what is installed:

```bash
/Applications/PiBrowse.app/Contents/MacOS/fury-agent install-core
```

### 3. Open it

Open PiBrowse from Applications. There is no account, no sign-up and no server: it
starts working immediately, and everything stays on this machine.

Team features — shared profiles, a shared proxy pool, per-project access — are
in **Settings → Team server**, which is also where you create an account and
where the instructions for running your own server are. Enter your team server address when you choose to connect. PiBrowse does not prefill an upstream server. You can keep using local mode without an account.

### Verifying what you downloaded

Every release has a `SHA256SUMS` file. Download it next to the archives and:

```bash
shasum -a 256 -c SHA256SUMS
```

Two `OK` lines mean the files are what was published.

### If macOS refuses to open it

Check the signing status and checksums published with the PiBrowse build. The upstream Fury macOS releases were signed and notarised from 21.09.2026; that history does not establish the signing status of a PiBrowse build. The steps below apply to an unsigned or locally built application.

**"PiBrowse cannot be opened because the developer cannot be verified."** This is
the normal result for an unsigned application, and it is what you should expect
for the *correct* file — an earlier version of this page told you to download it
again, which was a loop with no exit. Instead:

  1. Try to open it once and dismiss the dialog. Then System Settings →
     Privacy & Security, scroll to the bottom: next to *"PiBrowse" was blocked* press
     **Open Anyway** and confirm. macOS remembers the choice for that copy.
     (Right-click → **Open** used to be enough; since macOS 15 it is not.)
  2. Or strip the quarantine flag in Terminal, which is what the dialog is
     really about:

     ```bash
     xattr -dr com.apple.quarantine /Applications/PiBrowse.app
     ```

The same applies to the core: `fury-agent install-core` removes the flag from
what it unpacks, which is why the core needs no step of its own here.

**"PiBrowse is damaged and can't be opened."** On macOS 15 and later this is the
wording you get for an ad-hoc signed download, so it is the same case as above:
strip the quarantine flag only after checking the download source and published checksums. If the message survives the `xattr` step, the
seal is genuinely broken — something was added to or removed from inside
`PiBrowse.app` — and the fix is to delete it and unpack the download again.

**A core you built yourself will not start**, with a message about *Team IDs*.
That is a signing arrangement rather than a broken build; see
[tools/release/sign-core.sh](../tools/release/sign-core.sh), which explains it
in full.

## Windows

Use the Windows build listed on PiBrowse Releases. The compatible upstream Windows core has been exercised by `tools/verify-windows.ps1`; check the report attached to the core version you choose.

### 1. The application

Download the Windows installer listed on
[Releases](https://github.com/aronhy/pibrowse/releases)
and run it. An unsigned installer can trigger SmartScreen. Check the release and its published checksums before choosing **More info → Run anyway**.

The installer asks for nothing: it installs for the current user, into
`%LOCALAPPDATA%\PiBrowse` (legacy installations: `%LOCALAPPDATA%\Fury`), and needs no administrator password. That directory
holds `fury-desktop.exe`, `fury-agent.exe` and the uninstaller, and nothing
else.

### 2. The browser core

Open PiBrowse and press **Download the browser**, the same button as on macOS: it
fetches the compatible core; upstream archive names are
`fury-core-<version>-windows-x64.tar.xz` on [upstream Releases](https://github.com/furyteamtop/fury-antidetect-browser/releases), about 150 MB,
once, and installs it. Or by hand — download that file from the same page and,
in PowerShell:

```powershell
& "$env:LOCALAPPDATA\PiBrowse\fury-agent.exe" install-core "$env:USERPROFILE\Downloads\fury-core-<version>-windows-x64.tar.xz"
```

On Windows the install step reads the version out of the executable instead of
running it: `chrome.exe --version` starts a browser and never exits.

### 3. Open it

Open PiBrowse from the Start menu. Everything the macOS section says about accounts
applies: there are none until you want a team.

**Widevine** — Netflix, Spotify and the other DRM sites — is not in the
download, because it cannot be redistributed. The agent stages it out of the
Chrome already installed on the machine; a machine with no Chrome gets a
working browser without DRM, and a site that checks for it will notice.

## Linux

Not a target. This is a decision rather than a gap, and it is worth stating
plainly because an earlier version of this page promised a Linux release.

The Rust still compiles on Linux — CI runs there and contributors can run the
test suite — but there is no packaged release, no build configuration for the
core, and no plan for one. Two platforms that get tested are worth more than
three where one is a guess.

## Where things are kept

Everything PiBrowse owns is under one directory, so "back it up" and "remove it" are
each one operation:

```
~/Library/Application Support/Fury/
  fury.db          profiles, proxies, personas, projects
  profiles/        each profile's browser data — cookies, tabs, bookmarks
  core.bundle/     the installed browser (a package, so search
                   shows one PiBrowse rather than two)
  dock.noindex/    macOS: one clone of the browser per profile, named
                   after it for the Dock; APFS clones, so no real space
```

On Windows the same directory is `%APPDATA%\Fury` — Roaming rather than
Local, deliberately: on a domain-joined machine it follows the user, and
losing the database on a different machine would look like data loss rather
than a cache miss.

Set `FURY_HOME` to put it somewhere else — an external disk, or an encrypted
volume.

To remove PiBrowse completely: delete that directory and `/Applications/PiBrowse.app`
— on Windows, that directory and PiBrowse from Settings → Apps.
Nothing is written anywhere else, and nothing is left behind on any server you
did not set up yourself.

## Updating

From 0.3.0 the bar that says a new version is out has an **Update** button:
PiBrowse downloads the new version, checks its signature, installs it and restarts.
Profiles, proxies and settings stay. Close open profiles first; the button
says so if they are open. Before 0.3.0, and whenever you prefer to do it by
hand: download the new `.dmg` and drag the application over the old one. For a new core, run
`install-core` again with the new archive — it verifies the new one starts
before it replaces the one you have, so a bad download leaves you with a working
browser rather than none.

## How the Update button is kept safe

An updater is a channel into an anti-detect browser, so this one is built to
be no wider than a person downloading the installer themselves:

- **Nothing installs on its own.** The check only shows the bar; the install
  starts when you press the button, never on a schedule.
- **Only a build signed with the project's key installs.** Every release
  carries `latest.json` and a minisign signature for each platform's build; the
  application checks it against the public key it was built with, before it
  stops anything. A changed file, a different key or a release without a
  signature is refused, and the button falls back to the download link. The
  private key lives on the release machine and nowhere else.
- **Open profiles are never interrupted.** The button refuses while any is
  open; the background service is stopped only after the download has been
  verified.
- The download comes from GitHub over this machine's own connection, like the
  check, not through a profile's proxy.
