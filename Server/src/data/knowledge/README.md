# AI Knowledge dataset

Drop any reference material here for the in-app AI assistant to feed on. Everything in this
folder is embedded into the assistant's search index alongside the in-app Knowledge entries
(Settings → AI → Knowledge), the help content, and active company documents.

## Supported files
- **`.md` / `.txt`** — one knowledge source per file. The file name (without extension) becomes
  the title; the whole file body is the content.
- **`.json`** — an array of entries, same shape as the help file:
  ```json
  [
    { "id": "remote-work", "title": "Remote Work Policy", "text": "Staff may work remotely up to two days a week with manager approval…" },
    { "id": "expense-limits", "title": "Expense Limits", "text": "Meals are reimbursed up to SLE 200 per day…" }
  ]
  ```

## Applying changes
After adding or editing files here, rebuild the index: **Settings → AI → Reindex knowledge**
(or restart the server — it auto-indexes on startup when the index is empty). Long files are
automatically split into chunks for retrieval.

Tip: keep each fact or topic focused and self-contained — that retrieves far better than one
huge document.
