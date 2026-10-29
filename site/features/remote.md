---
title: Remote access
permalink: /features/remote/
---

# Remote access

Expose Argus to your phone with an ngrok tunnel, started from the toolbar.

- Start and stop the tunnel with one click, then copy or open the public URL.
- Starting a tunnel asks you to set a password. The URL and password are shown together.
- Argus keeps the computer awake while the tunnel is active.
- If ngrok is not installed, Argus shows install instructions.

Passwords are hashed with scrypt, and login issues a token that is checked on every API and socket request. Tokens are cleared when the tunnel stops.

The public URL gives full terminal access to all sessions. Share it only with people you trust.

See also: [Mobile view](../mobile/), [Status bar](../status-bar/).
