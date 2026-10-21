# Frontend requirements

- Verify responsive behavior for every UI change. Treat the mobile experience as a delivery requirement.
- Include 320, 360, 390, and 430px phone widths, a short keyboard viewport, and landscape interactions.
- Check touch targets, form and dialog scrolling, action reachability, and safe-area spacing. Use at least 44px touch targets for changed phone controls.
- Verify Chromium and WebKit. Screenshots and overflow checks alone do not prove usable mobile interactions.
- Use one 1px focus indicator that follows the visible field's rounded edge. Composite fields use their outer frame; avoid inner outlines and extra focus shadows.
- Use at least 16px text in phone input, select, and textarea fields to prevent automatic focus zoom. Keep user-controlled page zoom available.
- Count the bottom safe area once. Share mobile spacing values across navigation, usage, list padding, and the chat composer.
- Model and effort selectors must use concrete choices. Restore the last valid selection for that agent.
- Keep Happy Agent model preferences separate by computer because their catalogs can differ.
- Hide Happy Agent from creation and agent-switch controls. Keep existing sessions readable.
- If no saved choice is available, select an available concrete model and supported effort. Do not offer an agent-default choice.
- If no model is available, show the unavailable state and prevent a send or spawn with an implicit model.
- Keep v2 account preferences independent from v1. Preserve existing Tailscale routes and services.
- Keep the session list and previously loaded chat pages available after an offline reload. Encrypt cached account content and isolate it by account and server.
- Treat initial connection and workspace loading as normal states. Show the connection warning only after a failed attempt; keep it hidden during retry and known offline use.
