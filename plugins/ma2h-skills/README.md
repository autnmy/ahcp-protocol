# ma2h-skills

**The agent-native toolkit for [MA2H](https://ma2h.org)** — the Multi-agent to Human
Protocol: a vendor-neutral way for an agent fleet to coordinate with a human (`notify` · `ask` · `task`).

There are two sides to MA2H, and this plugin has a skill for each:

| Skill | Side | What it does |
|---|---|---|
| `/ma2h-skills:implement` | **Hub** (receiver) | Implement a conformant MA2H **Hub** in your app — receive messages, present them to a human, sign + route the response back. **Stack-agnostic** (any language/framework); graded against the conformance vectors, not a copied reference. |
| `/ma2h-skills:build-notify` | sender | Generate an app-specific `<app>-notify` skill — fire-and-forget notifications (digests, status, FYIs). |
| `/ma2h-skills:build-ask` | sender | Generate an app-specific `<app>-ask` skill — ask a human a decision; the signed answer routes back. |
| `/ma2h-skills:build-task` | sender | Generate an app-specific `<app>-task` skill — ask a human to do a manual action, then mark it done. |

The skills are **independent** — use only the ones you need. Building a Hub? Run `implement`. Only need
your agents to fire off notifications to an existing Hub? Just run `build-notify`.

## Install

```
/plugin marketplace add autnmy/ma2h-protocol
/plugin install ma2h-skills@ma2h
```

## Typical flow

1. **`/ma2h-skills:implement`** — stand up your MA2H Hub (the receiver), on your stack. *(Skip if you're
   sending to someone else's Hub.)*
2. **`/ma2h-skills:build-notify`** (and/or `:build-ask` / `:build-task`) — in the apps whose agents should
   *send* to that Hub, generate the app-specific verb skills, wired to its URL + auth.
3. The builders can also **package the generated skills as a plugin** in your repo, so your whole team
   installs them and points their agents at your Hub.

(They also auto-trigger from intent, e.g. "implement MA2H in my app" or "add MA2H notify".)

## License

Apache-2.0 · part of [autnmy/ma2h-protocol](https://github.com/autnmy/ma2h-protocol).
