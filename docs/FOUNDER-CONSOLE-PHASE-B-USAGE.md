# Founder Console Phase B usage

## Local authenticated preview

```bash
export FOUNDER_CONSOLE_DEV_AUTH=1
export FOUNDER_DEV_PASSWORD='choose-a-local-password'
export FOUNDER_CONSOLE_DEMO_FIXTURES=1
npm ci
npm run build
npm run console:dev
```

Open http://127.0.0.1:8787 and sign in as `founder` with that password. Do not commit the password.

Install the PWA from the browser install affordance (Chromium) or iOS Share → Add to Home Screen.

## Production private host

1. `npm run console:hash-password -- '<strong-password>'`  
2. Copy `deploy/console.env.example` to a private env file.  
3. Set `FOUNDER_SESSION_SECRET` (≥32 chars), `FOUNDER_AUTH_PASSWORD_HASH`, `FOUNDER_CONSOLE_DATA_DIR`.  
4. Bind 127.0.0.1 behind a private HTTPS reverse proxy, or set `FOUNDER_CONSOLE_ALLOW_REMOTE=1` only on a private network.  
5. `docker build -f deploy/Dockerfile .` — do not publish anonymously.

The process fail-closes if production persistence or credentials are missing.

## Slack / Cursor / ChatGPT

- Slack live dispatch: `SLACK_DISPATCH_ENABLED=1`, bot token, channel `#ai-ops` only. Tests use a fake transport.  
- Cursor: remains NOT_CONNECTED until a documented Cloud Agent dispatch API exists.  
- ChatGPT: remains NOT_CONNECTED until `FOUNDER_CHATGPT_DISPATCH=1` and a founder-approved OpenAI key.
