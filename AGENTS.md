# AkiSync Go

## Project scope

This repository is dedicated to **AkiSync Go**, the Android mobile app. AkiSync Go is the only AkiSync version in active use and development.

- Interpret requests about “AkiSync” in this project as requests about AkiSync Go. Apply fixes, features, and verification to the Android app in this repository.
- The original AkiSync web app and its Django server are retired. Read their source only when bringing an existing feature or behavior to AkiSync Go. Implement that work here.
- The Galaxy S24 Ultra browser preview is a development tool for AkiSync Go.

## Mockup-first workflow

For each request to change AkiSync, ask before implementation whether the user wants to try a live mockup first. Use a question such as “Would you like a live Galaxy S24 Ultra mockup first, or should I implement the change directly?” If the user already chose a mockup or authorized implementation, follow that choice.

For a mockup, open the relevant screen in the Galaxy S24 Ultra preview below and leave the tab available for the user to try. Use fictional records when the flow needs data. Keep the mockup separate from the mobile app’s implementation until the user approves it. A request to implement an approved mockup is authorization to proceed.

## Codex browser preview

When showing the AkiSync mobile preview in the Codex browser, use `http://127.0.0.1:5173/preview/s24-ultra.html`. The page keeps the app at the Galaxy S24 Ultra portrait size of 384 × 832 CSS pixels across reloads and browser panel resizing. Open or reuse that tab and leave it available for the user to browse.

### Start the mockup

When the user says “Start the mockup”, open the interactive Galaxy S24 Ultra preview on AkiSync’s main Today screen at `http://127.0.0.1:5173/preview/s24-ultra.html#/today`. If the user specifies a mockup or screen, open that one instead.

Reuse the preview server if it is running. Otherwise, run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` from the repository root and leave the server running. Open or reuse the Codex browser tab, verify that the requested screen is visible, and leave the tab open for the user to try. Preserve existing fictional records and wait for feedback before editing the mockup or the Android app.
