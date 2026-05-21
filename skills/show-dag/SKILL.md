---
name: show-dag
description: Prints a compact rundown of the current canvas notes to chat. Use when the user says "what do we have", "show the graph", "list the notes", "summarize", or any phrasing asking for a rundown of what is currently on the canvas.
---

## Recipe

1. Read `./workflow.json`. If the file is missing or `nodes` is empty, reply exactly: "Canvas is empty — nothing to show yet." and stop.

2. Print a compact rundown in this format. Prefix each note with a tag from `data.subtype` so scripts and shots are visually distinct from generic notes (`📜 script`, `🎬 shot`, no prefix for generic):

   ```
   📊 **<title or "Untitled">** — <N> notes

   • `note_0` 📜 script — "<label>" — "<body excerpt ≤60 chars>"
   • `note_1` 🎬 shot — "<label>" — "<body excerpt ≤60 chars>"
   • `note_2` — "<label>" — "<body excerpt ≤60 chars>"
   ```

3. Keep the output under 12 lines. If there are more than 10 notes, show the last 8 and prefix the list with "<M> earlier notes…". When a script has many derived shots, you can collapse the shot family into one line ("Shots 1–N (15s each) from `note_0`") rather than listing each shot.

4. Do NOT dump raw JSON.
