# Superbrain

A markdown notes workspace that runs entirely in the browser. Point it at a folder of
`.md` files and you get a linked, editable vault — file tree, wiki links, backlinks,
comments and a graph view. There is no server, no account, and nothing is uploaded.

Think Notion's editing next to Obsidian's linking, without the install.

## What it does

- **Import** a folder, individual files, or a whole vault as a `.zip`, by picking or dragging
  them in. Folder structure is preserved and pictures come along with the notes.
- **Read, then edit on purpose.** Notes open read-only; `Edit note` (or `⌘E`) opens them
  for writing, and nothing reaches storage until you press Save. Leaving with unsaved work
  asks first.
- **Read and edit** in a WYSIWYG editor that speaks markdown: headings, tables, task lists,
  code blocks, quotes, highlights, embedded media. Files round-trip byte-for-byte, including
  YAML frontmatter.
- **Link** with `[[wikilinks]]`, `[[path/to/note|aliases]]`, `![[embeds]]`, or ordinary
  markdown links. Type `[[` for autocomplete; `/` opens a block menu.
- **Reorganise** freely — rename, drag to reorder, move between folders, delete. Every link
  that pointed at the thing you moved is rewritten so it still points at it, including
  relative paths inside the note you moved.
- **Comment** on any selection. Comments are anchored to the quoted text and stored
  alongside the vault, never inside your markdown.
- **See the shape of it** in a force-directed graph of notes, folders and assets. Hover to
  isolate a note's neighbourhood, click to open, drag to rearrange.
- **Search** everything with `⌘K` — titles, paths and note bodies.
- **Skim a long note** with TL;DR — a summary built from the note's own sentences by
  word frequency and structure. No model, no network, nothing generated.
- **Reopen what you had.** Every vault you've opened is offered again on the welcome
  screen, folders included, so you never have to go hunting for it twice.
- **Keep several vaults** in the browser, name them, and rename them later.
- **Lock a vault with a password** on the way out. Everything is encrypted and the
  readable copy is deleted; the right password puts it back.
- **Link to anything.** Every note, folder and file has a real URL —
  `/Projects/Ideas/Roadmap.md` — so you can bookmark it, share it, use back and
  forward, and reopen where you left off.
- **Export** the whole vault as a `.zip`, or one note as a **single self-contained HTML
  file** with its styles and pictures inlined, which opens anywhere with no server.
- **Tag** notes with `#tags` or frontmatter, and filter the tree by them.
- **Deleting is undoable.** Everything goes to a trash you can put it back from.
- **Install it** as a PWA. It works with no network at all.
- **Switch theme** between light, dark and follow-the-system. The new theme flips in
  as a grid of pixels sweeping from the left, and the choice is remembered.

## Where your data lives

Storage is a setting on a vault, not a question asked before you have one. The welcome screen
offers a new vault, an existing folder of notes, or a `.zip` to restore; **Vault settings** then
decides where that vault saves, and can move it either way at any time.

Moving a browser vault to a folder writes everything into the folder you pick and keeps
working from there, and the folder is remembered so the vault reopens from it next time.
Moving back into the browser leaves the folder untouched and simply stops writing to it.
Everything is written and verified before the old copy is released, so a failure part way
through leaves the original intact. Pictures cannot come into browser storage, and the
dialog says so rather than dropping them quietly.


Two backends, chosen on the welcome screen.

| | Folder on disk | Browser storage |
|---|---|---|
| Notes | real `.md` files you can open in any editor | IndexedDB |
| Images, video, other binaries | real files beside the notes | **not stored** — see below |
| Survives a reload | yes | notes yes, binaries no |
| Works in | Chrome, Edge, Opera | every modern browser |

**Folder on disk** uses the File System Access API. Your notes stay as ordinary markdown
files in a folder you choose, so Obsidian, git, ripgrep and everything else still work on
them. Ordering, ids and comments live in a `.superbrain/vault.json` sidecar inside the
folder; delete it and you still have all your notes.

**Browser storage** deliberately keeps notes only. Binaries are held in memory for the
session and are *not* written to IndexedDB, so after a reload an image shows as "detached"
with a one-click re-link. If you want images to persist, use a folder on disk.

Nothing is ever sent anywhere. There is no network code in the app beyond loading itself.

## Editing, saving and the trash

Editing is explicit. A note opens read-only, `Edit note` makes it writable, and Save is what
writes to storage. While you type, the working text still feeds the outline, summary and link
panels, but the last saved copy is held aside so Discard can put it back. Anything that would
take you away from unsaved work asks first: switching notes, following a link, the address
bar, closing the vault, and closing the tab.

Deleting moves entries to a trash rather than destroying them. On disk the files are parked
under `.superbrain/trash`, which the scanner ignores, so your working folder looks the same
as if they were gone while the bytes are still there. Restoring puts them back where they
came from, recreating any folders that went with them and renaming around anything that has
since taken the name. Emptying the trash is the only step that actually deletes.

## What a vault accepts

A vault only takes what it can show:

| | |
|---|---|
| Notes | `.md` |
| Pictures | `.webp` `.jpg` `.jpeg` `.avif` `.gif` `.png` `.svg` |
| Video | `.mp4` |

Anything else is refused at the door rather than imported and left sitting there as a file
nothing can open. The same list applies when a folder on disk is scanned, so a PDF in your
notes folder stays on disk and simply is not listed.

A top-level folder also has to have a `.md` file somewhere inside it, at any depth, or it is
not imported at all. That is what stops a folder of holiday photos becoming a book. The check
is per top-level folder rather than per folder, so an `assets` directory sitting inside a
vault still arrives with it, which it has to, because that is where the pictures its notes
point at live.

Whatever gets refused is reported rather than silently dropped, naming the file types and the
folders that were left out.

Dropping a `.zip` restores a whole vault from it: it is unpacked, screened the same way, and
opened. A zip that wraps everything in one top-level folder has that wrapper stripped, so a
vault does not end up nested inside a folder named after itself. Exporting to `.zip` and
dropping it back gives you the same book.

## Ordering

Files are listed by name: digits before letters, and a shorter name before one that extends
it, so `0` comes before `00` before `1`, and `9` before `A`. It is dictionary order, not
natural order, so `10` sorts before `2`.

Names are only used when files first arrive, whether from an import or a folder scan. After
that the stored positions win, so dragging something into place sticks, and importing into a
folder you have already arranged appends the new files rather than reshuffling it.

## Look and feel

Light and dark are both first-class; a three-way toggle (light / system / dark) sits in the
top bar and on the welcome screen, and "system" keeps following the OS while it is selected.
An inline script stamps the theme before first paint, so there is no flash on load.

Type is Geist, self-hosted through Fontsource so it works with no network like the rest of
the app.

Every foreground/background pairing in both palettes is measured, not eyeballed: body text
clears 7:1, all other text clears 4.5:1, and borders clear 1.5:1 against the surface they sit
on. `/dev/contrast-check.html` re-checks all 72 pairings against the live stylesheet.

Destructive actions explain themselves before they happen: deleting a folder says how many
notes and folders go with it, rather than the native confirm's generic warning. Closing a
vault says where the notes will still be, and leaves it in the recent list.

Motion is used to explain change rather than to decorate: the theme flip, a sliding pill on
the Notes/Graph switch and the theme toggle, notes fading up as you move between them,
overlays scaling in from where they belong, staggered entrances on the welcome screen, and a
sweep on the "Saving" indicator. All of it collapses to nothing under
`prefers-reduced-motion: reduce`.

The theme change runs entirely through the View Transition API. The browser holds a snapshot
of the outgoing page underneath while the incoming one is revealed through an animated
`clip-path`, so **nothing is added to the DOM, nothing reflows, and the text you are reading
stays on screen the whole way through**. The clip is a staircase quantised to a 30px grid:
each row gets its own head start and the odd one-tile outrider, and every stage holds
(`steps(1, end)`) rather than interpolating — which is what makes it read as pixels flipping
on in a wave rather than a line sliding across.

Where the View Transition API is missing, or the tab is not being rendered, or motion is
turned down, the theme simply swaps instantly. `/dev/contrast-check.html` verifies the reveal
geometry — that every row starts closed, ends fully open, never moves backwards, and lands on
tile boundaries.

## URLs

Every node is a route. Notes open in the editor, folders show an index of what is inside
them, assets show a preview, and anything that doesn't resolve gets a 404 that offers to
create the note at that path.

Paths are real, not hash fragments, which means **the host has to serve `index.html` for
unknown paths**. Without that, a deep link 404s on the server before the app ever loads.

| Host | Config |
|---|---|
| `pnpm dev` / `pnpm preview` | works out of the box |
| Netlify | `public/_redirects` (already in the repo) |
| Vercel | `vercel.json` (already in the repo) |
| nginx | `try_files $uri /index.html;` |
| Caddy | `try_files {path} /index.html` |
| GitHub Pages | copy `dist/index.html` to `dist/404.html` |
| Plain `python -m http.server` | no fallback, so deep links will 404 |

Two consequences worth knowing. The app can no longer be opened straight off disk over
`file://`. And every URL it emits carries the `base` from `vite.config.ts`; the router reads
that back from `import.meta.env.BASE_URL`, so routes follow automatically once it is set.

### Published at a subpath

`base` is `/superbrain/`, because the app is published at `lowkey.tools/superbrain` and
reached through a proxy:

```json
// lowkey.tools/vercel.json
{ "source": "/superbrain",        "destination": "https://superbrain.lowkey.tools" },
{ "source": "/superbrain/:path*", "destination": "https://superbrain.lowkey.tools/:path*" }
```

That rewrite **strips** the prefix, so the origin receives `/Welcome.md` while the browser's
address bar says `/superbrain/Welcome.md`. The base is what keeps the two in step: the page
asks `lowkey.tools` for `/superbrain/_superbrain/index-abc.js`, the proxy hands the origin
`/_superbrain/index-abc.js`, and a real file comes back.

With `base: '/'` this does not work at all. The HTML would ask for `/_superbrain/index-abc.js`
at the domain root, which matches none of those rewrites, and the page renders blank.

The origin stays usable on its own: `vercel.json` rewrites `/superbrain/(.*)` to `/$1` ahead
of the SPA catch-all, so `superbrain.lowkey.tools/` and `superbrain.lowkey.tools/Welcome.md`
both work. Both hosts serve the same page, and both declare the same canonical, so search
engines fold them together rather than treating one as a duplicate.

## Discovery

The app is one page as far as a crawler is concerned, so the metadata all lives in
`index.html` and the crawler files are static in `public/`.

| File | What it is for |
|---|---|
| `public/robots.txt` | Allows everything, and names the answer-engine and generative-engine crawlers explicitly. Points at the sitemap. |
| `public/sitemap.xml` | One URL, the canonical one, with the social card attached. |
| `public/llms.txt` | The [llmstxt.org](https://llmstxt.org) summary: what the app is, what it does, and the answers to the questions people actually ask. |
| `public/og.png` | 1200x630 social card, generated by `pnpm icons` from the same dolphin the favicon comes from. Replace it with a designed one whenever you like; the meta tags point at the path, not the artwork. |

`index.html` carries the canonical link, the Open Graph and Twitter tags, and one JSON-LD
`@graph` holding four linked nodes: the `WebApplication`, the `Person` who wrote it, the
`Organization` behind it, and an `FAQPage`. The FAQ is there because answer engines quote
it directly, which is the whole point of writing one.

Every note route serves the same shell, so all of them declare the same canonical URL.
That is what stops `/Projects/Ideas.md` being indexed as a thin duplicate of the home page.

Two of these files only work from the root of a domain. `robots.txt` and `llms.txt` are
read at `https://example.com/robots.txt`, never at `https://example.com/subpath/robots.txt`.
If the app is served under a path, copy those two into the root project as well.

## Caching

Everything except the app shell is served immutable for a year, which is safe because
every file under `/_superbrain/` carries a content hash in its name: change the bytes and
you change the URL, so a stale copy can never be served.

| Path | Cache-Control |
|---|---|
| `/_superbrain/*`, `/workbox-*.js` | `public, max-age=31536000, immutable` |
| the same two under `/superbrain/*`, for direct origin visits | `public, max-age=31536000, immutable` |
| `/favicon.svg`, `/icon-*.png`, `/apple-touch-icon.png`, `/manifest.webmanifest` | `public, max-age=31536000, immutable` |
| `/og.png` | `public, max-age=86400` |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | `public, max-age=0, must-revalidate` |
| `/`, `/index.html`, `/sw.js` | `public, max-age=0, must-revalidate` |
| note and folder routes | Vercel's default for static HTML, which is `max-age=0, must-revalidate` |

`index.html` and `sw.js` are the two files that must stay fresh. `index.html` names the
current hashed bundles, and `sw.js` is how an installed PWA learns there is a new version.
Caching either one for a year would freeze the app permanently for anyone who had already
visited, so a release would never reach them.

The crawler-facing files are deliberately not immutable: `robots.txt`, `sitemap.xml` and
`llms.txt` are meant to be edited, and `og.png` gets a day so a replacement card shows up
the same week rather than the same year.

The icons and `manifest.webmanifest` are the one sharp edge: their names are fixed rather
than hashed, so they are immutable for a year under a name that never changes. **If you
ever change an icon or the manifest, rename the file** (and update the reference in
`vite.config.ts`), or people who have already visited will keep the old one until the year
is up.

Rules live in `vercel.json` and are matched against the incoming request path, before the
SPA rewrite runs. That is deliberate: they only match real files, never note routes, so a
route like `/Projects/Ideas.md` can never pick up an immutable header while serving the app
shell.

Build output is written to `/_superbrain/` rather than the usual `/assets/`, because note
collections very often have an `assets` folder of their own and `/assets/diagram.png` would
otherwise collide with the bundle's own URLs.

The installed PWA uses the same fallback offline, via the service worker's `navigateFallback`.

## Keyboard

| | |
|---|---|
| `⌘K` / `⌘P` | search and jump |
| `⌘N` | new note |
| `⌘S` | flush pending writes |
| `⌘\` | toggle the sidebar |
| `⌘⇧G` | toggle the graph |
| `⌘⇧M` | comment on the selection |
| `⌘B` `⌘I` `⌘K` | bold, italic, link |
| `F2` / `Delete` | rename / delete the focused tree row |
| `/` | block menu |
| `[[` | link autocomplete |

## Running it

```bash
pnpm install
pnpm dev
```

Build a static bundle — it is plain files, host it anywhere or open it from disk:

```bash
pnpm build
```

## How it fits together

```
src/
  lib/
    markdown.ts   link extraction + rewriting over raw markdown text
    links.ts      resolver, backlink graph, and the retargeting rules
    paths.ts      tree <-> path conversions
    router.ts     path routing over the History API
    theme.ts      light/dark/system, and the pixel reveal
    export.ts     zip writer
  store/
    vault.tsx     the store: tree, bodies, comments, and every mutation
    fs.ts         File System Access backend
    idbAdapter.ts IndexedDB backend
  editor/
    NoteEditor.tsx  TipTap setup, content sync, paste/drop handling
    wikilink.ts     [[...]] as a real node, with markdown round-tripping
    media.ts        vault-relative images/video, and tight task lists
    comments.ts     comment highlights as decorations, not marks
  components/     tree, graph, panels, dialogs
```

Two ideas carry most of the weight:

**Comments are decorations, not marks.** They are matched back onto the text by their
quote each time a note renders, so nothing about them ever touches your markdown.

**Link rewriting is one rule.** After any tree change: if a link resolved to something
before and no longer resolves to that same thing, rewrite it — otherwise leave the
author's wording alone. Renames, moves and folder reshuffles all fall out of that. Wiki
links resolve by name (Obsidian's convention); markdown links resolve as real relative
paths (what every other tool expects), which is why moving a note fixes its own
`../assets/…` links.

## Checks

Three browser-run suites, dev only:

- `/superbrain/dev/fs-check.html` — exercises the File System Access backend against OPFS, which
  implements the same handle API without needing a native folder picker.
- `/superbrain/dev/link-check.html` — unit checks for link extraction, resolution, rewriting,
  relative paths and frontmatter.
- `/superbrain/dev/contrast-check.html` — reads the real CSS custom properties for each theme and
  checks every text/background and border pairing the UI uses, plus the geometry of the
  theme reveal.

Open them with the dev server running. The `/superbrain/` prefix is the `base` from
`vite.config.ts`; Vite serves the whole app under it, in dev as well as in the build.

## Locking a vault

Closing a browser vault offers to encrypt it. Everything it holds is encrypted with a
key stretched from your password, and the readable copy is deleted. Entering the password
again decrypts it in place.

The details, in `src/lib/crypto.ts` and `src/store/lock.ts`:

- **PBKDF2-HMAC-SHA256**, 310,000 iterations (the OWASP figure for this construction), with
  a fresh 16-byte salt per book. Argon2 resists GPUs far better, but it is not built into
  browsers, and shipping a WASM KDF would mean downloading a megabyte into a tool whose
  whole point is that it downloads nothing.
- **AES-GCM-256** with a fresh 12-byte IV per value. GCM authenticates, so a wrong key
  fails the tag check rather than returning plausible rubbish. That is also what makes the
  password check honest: a short known token is encrypted at setup and decrypted to test a
  candidate password.
- **Nothing derived from the password is stored.** There is no recovery, and the dialog says
  so before it will accept the password.
- **Ordering is deliberate.** Every value is encrypted and read back before any plaintext is
  removed, and on unlock everything is decrypted before any ciphertext is removed. A failure
  part way through either direction leaves a complete, recoverable copy.

Two limits worth stating plainly. Once unlocked, the vault stays readable until you close
it again with a password, which is what "restored once the correct password is entered"
means. And **folder vaults cannot be locked**: their whole point is that your notes are
ordinary `.md` files you can open in anything, and this app will not quietly turn them into
unreadable ones. Use an encrypted disk or volume for that folder instead.

## TL;DR, without a model

`src/lib/tldr.ts` ranks the note's own sentences and shows the best few in document order.
It is TextRank: sentences vote for each other in proportion to how much vocabulary they
share, and the vote is run to a fixed point, so a sentence that overlaps with many others is
by that measure about what the note is about. On top sit a few nudges that matter in notes
specifically: the sentence opening a section usually states the point, headings tell you what
the note is about, and list items and bold text are already the author's own emphasis. Fenced
code is excluded.

Selection is a two-part problem, and the second part is the one that matters. TextRank ranks
a repeated idea highest by construction, because near-identical sentences vote for each
other, so relevance alone returns the same thought three times over. A redundancy gate fixes
that: while genuinely different material is still available, anything too close to a point
already taken is passed over, and marginal relevance orders whatever is left. Only when
nothing distinct remains does the gate open, so a note that really is about one thing still
fills its quota.

It is extractive, so every bullet is a sentence you actually wrote. Nothing is invented, and
nothing leaves the device.

## The mark

The dolphin lives in `src/brand/mark.svg`, the single source for the app logo, the favicon
and every launcher icon. Its viewBox is a square centred on the artwork's measured bounds,
so the mark is transparent, centred, and lines up with text wherever it is dropped.
`BrandMark` inlines that file and rewrites its internal ids per instance, so several marks
can render at once without their gradients colliding.

After editing it, regenerate the derived files — the favicon plus PNGs at 192, 512, a
full-bleed maskable 512, and an Apple touch icon (the dark plate is composited here rather
than baked into the source):

```bash
pnpm icons
```

## Known limits

- The folder backend needs the File System Access API: Chrome, Edge and Opera have it;
  Safari and Firefox do not. Those browsers get browser storage.
- The whole vault is read into memory on open so search, backlinks and the graph can be
  instant. Fine for thousands of notes; not designed for hundreds of thousands.
- The frontmatter parser handles scalars and simple lists, not full YAML. Anything it does
  not understand is preserved verbatim rather than reformatted.
- Two notes with the same file name in different folders resolve a bare `[[Name]]` link to
  whichever comes first; use a path to disambiguate.
- Routes need a host that rewrites unknown paths to `index.html`; see the table above.
- The recent-vaults list stores directory handles, which are per-browser and per-profile —
  it does not follow you to another machine, and a folder that has been moved or deleted on
  disk will fail to reopen.
- TL;DR is extractive, not abstractive: it selects sentences, it does not rewrite them, so a
  note with no prose (only headings, tables or code) has nothing to summarise.
- Password locking covers browser vaults only, and a forgotten password is unrecoverable
  by design.
- `.markdown`, `.mdx` and `.txt` are no longer accepted as notes; only `.md` is.
- A folder named `_superbrain` at the vault root would collide with the build output's URLs.
