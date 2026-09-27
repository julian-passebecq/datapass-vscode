# DataPass shared memory

Durable things learned by sessions (pitfalls, working commands, Julian's preferences), dated, newest last.

- 2026-09-27 (V1-RC3): a view's `<id>.focus` command accepts `{ preserveFocus: true }`, which shows the view without taking the keyboard. Focusing the view and then handing focus back to the editor still closes an open Quick Pick. A webview must restore element focus only when `document.hasFocus()`.
