# Automation

Driving Fury profiles from a script: what the API is, what it deliberately is
not, and four working examples.

## Turning it on

The API is **off**. Not off-by-default-in-a-config — nothing binds a port until
you say so:

```bash
FURY_API_PORT=35000 fury-agent serve
```

A local HTTP port is a way into every logged-in profile on the machine, so it
exists because somebody asked for it and not because they installed something.
`0`, an empty value or a typo all leave it off, which is the direction a
mistake should fail in.

Authentication is one token, in one file, created on first use:

```bash
cat "$HOME/Library/Application Support/Fury/api-token"
```

Mode 0600, and file permissions are the whole authorisation story — the port
listens on 127.0.0.1 only. Send it as `Authorization: Bearer <token>`. The
comparison is constant-time, because an attacker controls one side of it.

## The surface

Fifteen endpoints. Each one is exactly one of the methods the desktop shell
calls, so the HTTP surface cannot drift away from what the application does and
be separately wrong. A read is a `GET`; anything that changes something is a
`POST` with a JSON body.

| | | |
|---|---|---|
| `GET`  | `/v1/status`               | is the agent up, and what does it have |
| `GET`  | `/v1/profiles`             | profiles, with which are running |
| `GET`  | `/v1/proxies`              | the proxy pool |
| `GET`  | `/v1/personas`             | the persona catalogue |
| `POST` | `/v1/profiles/start`       | `{"id": "...", "cdp": true}` |
| `POST` | `/v1/profiles/stop`        | `{"id": "..."}` |
| `POST` | `/v1/profiles/connection`  | `{"id": "..."}` — where an open profile's browser is |
| `POST` | `/v1/profiles/usage`       | `{"id": "..."}` — how big it is, and how much of that is cache |
| `POST` | `/v1/profiles/trim`        | `{"id": "..."}` — remove the caches, keep the session |
| `POST` | `/v1/profiles/reseed`      | `{"id": "..."}` — a new noise seed on the same machine |
| `POST` | `/v1/profiles/randomize`   | `{"id": "..."}` — another machine of the same OS, and a new seed |
| `POST` | `/v1/proxies`              | a proxy as `/v1/proxies` lists it; an empty `id` makes one |
| `POST` | `/v1/proxies/check`        | `{"url": "socks5://user:pass@host:port"}` — where it comes out |
| `POST` | `/v1/proxies/rotate`       | `{"id": "..."}` — call the proxy's rotation link, through the proxy |
| `POST` | `/v1/proxies/delete`       | `{"id": "..."}` |

`start` with `"cdp": true` returns a DevTools endpoint:

```json
{ "ok": true, "data": {
    "pid": 40213,
    "relay_port": 51834,
    "debug_port": 51835,
    "ws_endpoint": "ws://127.0.0.1:51835/devtools/browser/9c1f...",
    "ws": { "puppeteer": "ws://...", "selenium": "ws://..." }
} }
```

The endpoint is under both names because the two libraries people actually use
spell it differently and neither accepts the other's.

`connection` answers the same thing for a profile that is already open, for a
script that did not start it or has lost the answer — a second `start` is
refused, so before this the only way back to a browser was to close it:

```json
{ "ok": true, "data": { "running": true, "pid": 40213, "relay_port": 51834,
    "debug_port": 51835, "ws_endpoint": "ws://127.0.0.1:51835/devtools/browser/9c1f...",
    "ws": { "puppeteer": "ws://...", "selenium": "ws://..." } } }
```

`{"running": false}` when it is not open, and no endpoint when it was opened
without `cdp` — from the application's window, for instance. It gives out
nothing the launch did not.

## Between two runs of one profile

`trim`, `reseed` and `randomize` are refused while the profile is open, with
the same words the application uses: Chromium holds the cache, and a
fingerprint must not change in the middle of a session. Stop it first.

- **`trim`** removes the caches and nothing else. Cookies, local storage and
  the service workers stay, so the profile is still signed in.
- **`reseed`** keeps the machine and replaces the seed the canvas, audio and
  geometry noise come from.
- **`randomize`** replaces the machine as well: another persona of the same OS,
  drawn by how common each is, never the one it had. Cores, memory, GPU and
  screen pinned by hand are dropped, because they were pinned for the old
  machine; locale, position, the proxy and the browser data stay. It is the
  Random button of the profile dialog, saved. With no other machine of that OS
  in the catalogue it refuses rather than move the profile to another OS.

A proxy is written whole: read it from `GET /v1/proxies`, change what you mean
to, and send it back. Every profile on that proxy follows, which is how one
exit is moved for all of them at once and also the thing to remember before
doing it. `check` takes a proxy as a URL rather than an id, so it can be asked
before anything is saved.

A profile with an account in it is that account's machine. `reseed` and
`randomize` are for a profile that is being started over, not for one that is
in use — a machine that changes overnight is the anomaly platforms look for.

## What it is not

**There is no create-profile endpoint, and that is on purpose.** A profile is a
persona, a proxy and a seed that have to agree with each other; the application
builds one that is internally consistent and the API would let a script build
one that is not — a machine that reports 128 GB of memory with two cores, which
is a *stronger* signal than no spoofing at all. Make profiles in the
application, drive them from a script.

**CDP is off unless you ask.** `"cdp": true` opens a debugging port on
localhost; without it there is none. A team server can also forbid it per role,
in which case the request succeeds and returns no endpoint — check for
`ws_endpoint` rather than assuming it.

**Automation is detectable and this does not hide that.** `navigator.webdriver`
is false in Fury, but a page can time `console.debug` and see a driver. Measured
on Fury 150, microseconds per call:

| | `"hello"` | 50-key object | 800-key object |
|---|---|---|---|
| no debugger | 3.0 | 2.8 | 2.8 |
| CDP attached, `Runtime.enable` **not** called | 2.8 | 2.8 | 2.8 |
| CDP attached, `Runtime.enable` called | 8.0 | 14.0 | 25.5 |

Attaching costs nothing; `Runtime.enable` costs 2.7x on a string and more as the
argument grows. Every driver calls it. Real Chrome measures the same, so this
detects a driven browser rather than Fury — which is no comfort if the driven
browser is yours. Run it yourself with
[`tools/detect-suite/cdp-timing.py`](../tools/detect-suite/cdp-timing.py).

If a site matters, drive it slowly and like a person, or do not drive it: `cdp`
is off unless you ask, and a team server can refuse it per role.

## The examples

| | |
|---|---|
| [`api.sh`](api.sh) | The whole API in curl. Start here — it is the shortest path from nothing to a browser you opened from a script. |
| [`playwright_example.py`](playwright_example.py) | `connect_over_cdp`, the usual Python route. |
| [`puppeteer_example.mjs`](puppeteer_example.mjs) | `connect`, the usual Node route. |
| [`rotate.py`](rotate.py) | The thing people actually want: run one job across every profile in a project, one at a time, and never leave a browser open on a failure. |

All four take the profile id from the command line, so:

```bash
./api.sh                        # lists profiles and their ids
./api.sh <profile-id>           # starts one, opens a page, stops it
```

## Do not put the token in your script

Read it from the file. It is a bearer token for every account on the machine,
and a script is the thing that gets pasted into an issue.
