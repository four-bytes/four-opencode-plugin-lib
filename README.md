# @four-bytes/opencode-plugin-lib

[![npm](https://img.shields.io/npm/v/@four-bytes/opencode-plugin-lib)](https://www.npmjs.com/package/@four-bytes/opencode-plugin-lib)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-bun-orange)](https://bun.sh)

Shared utilities for [opencode](https://opencode.ai) plugins.

## Install

```bash
npm install @four-bytes/opencode-plugin-lib
```

## Usage

```ts
import { createToast } from "@four-bytes/opencode-plugin-lib";
import type { PluginInput } from "@opencode-ai/plugin";

const _serverPlugin = async (input: PluginInput) => {
  const toast = createToast(input.client, "My Plugin 🚀");
  toast("Operation complete", "success");
};
```

## API

### `createToast(client, defaultTitle)`

Creates a toast function bound to a plugin client. Silently swallows all errors — never breaks plugin operation on UI failure.

Returns: `(message: string, variant?: "info" | "success" | "warning" | "error", title?: string) => void`

## License

Apache-2.0

---

> If this plugin saves you tokens, consider leaving a ⭐ on [GitHub](https://github.com/four-bytes/four-opencode-plugin-lib).

## Bus Architecture

**Port:** Fixed port `4099` — no port discovery, no `port.json`.

**Transport:** Unix-domain socket for local same-process; TCP `localhost:4099` for cross-process (requires `four-local-bus` binary).

```
~/.local/bin/four-local-bus   # Go binary (statically linked)
```

**Channel convention:** Session-scoped channels for per-session communication:

```
{plugin}/{sessionID}
```

**Server side:** Capture sessionID from hook callbacks (`chat.message.input.sessionID`, `event.properties.sessionID`).

**TUI side:** Receive sessionID from slot props (`sidebar_content.props.session_id`).

**Wildcard:** TUI can subscribe to `{plugin}/+` for all sessions.
