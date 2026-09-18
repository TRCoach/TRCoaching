# Install the Founder Console PWA

The console is founder-only. Use localhost (`FOUNDER_CONSOLE_DEV_AUTH=1`) or the private `workers.dev` URL after deploy. Do not publish the URL.

## Windows (Edge or Chrome)

1. Open the console HTTPS URL and sign in.
2. Use the install icon in the address bar, or menu → **Install app** / **Add to taskbar**.
3. Pin the installed app if you want a desktop shortcut.

## iOS (Safari)

1. Open the URL in Safari and sign in.
2. Share → **Add to Home Screen**.

## Android (Chrome)

1. Open the URL and sign in.
2. Menu → **Install app** or the install banner.

Offline: the service worker serves `offline.html` for the shell. API calls fail closed and do not talk to providers.
