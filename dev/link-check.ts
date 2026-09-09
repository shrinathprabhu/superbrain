/**
 * Unit checks for the parts with the most edge cases: link extraction, the
 * resolver, and the rewrite that keeps links pointing where they pointed.
 * Dev-only; not part of the production bundle.
 */
import { extractLinks, parseFrontmatter, rewriteLinks, excerpt, headings, tagsIn } from '../src/lib/markdown'
import { tldr } from '../src/lib/tldr'
import { createLock, decrypt, encrypt, passwordStrength, unlockKey } from '../src/lib/crypto'
import { screenFiles } from '../src/lib/intake'
import { isAccepted } from '../src/lib/util'
import { makeResolver, retargetLinks, relativePath } from '../src/lib/links'
import { childrenOf, compareNames, orderNewByName, resolveRelative, uniqueName } from '../src/lib/paths'
import type { VaultNode } from '../src/lib/types'

const out = document.getElementById('out')!
let failures = 0
let list: HTMLUListElement

function section(title: string) {
  const h = document.createElement('h2')
  h.textContent = title
  list = document.createElement('ul')
  out.append(h, list)
}

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  const ok = a === b
  if (!ok) failures++
  const li = document.createElement('li')
  li.className = ok ? 'pass' : 'fail'
  li.textContent = ok ? `PASS  ${label}` : `FAIL  ${label}\n      expected ${b}\n      actual   ${a}`
  li.style.whiteSpace = 'pre'
  list.append(li)
}

// ---------------------------------------------------------------- fixtures
/** Builds a real tree from paths; node ids are the paths themselves. */
function vault(...specs: [string, VaultNode['kind']?][]): VaultNode[] {
  const byPath = new Map<string, VaultNode>()
  let order = 0
  for (const [path, kind = 'note'] of specs) {
    const parts = path.split('/')
    let parentId: string | null = null
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('/')
      if (!byPath.has(prefix)) {
        byPath.set(prefix, {
          id: prefix,
          parentId,
          name: parts[i],
          kind: i === parts.length - 1 ? kind : 'folder',
          order: order++,
          createdAt: 0,
          updatedAt: 0,
        })
      }
      parentId = prefix
    }
  }
  return [...byPath.values()]
}

const nodes = vault(
  ['Home.md'],
  ['Projects/Ideas/Brainstorm.md'],
  ['Daily/2026-09-01.md'],
  ['assets/pic.png', 'asset'],
)
const id = (path: string) => path
const find = (path: string) => nodes.find(n => n.id === path)!

// ----------------------------------------------------------- link extraction
section('extractLinks')
{
  const md = [
    'A [[Wiki]] and an ![[Embed]] and [[Path/To|alias]].',
    'A [md link](Daily/2026-09-01.md) and ![img](assets/pic.png).',
    'External [site](https://example.com) and [mail](mailto:a@b.c) are ignored.',
    'Inline `[[NotALink]]` is ignored.',
    '```',
    '[[AlsoNotALink]]',
    '```',
    'A [[Heading#Anchor]] keeps its hash.',
  ].join('\n')
  const links = extractLinks(md)
  eq('links on later lines of a fenced block are ignored',
    extractLinks(['```', '[[One]]', '[[Two]]', '[[Three]]', '```'].join('\n')).length, 0)

  eq('finds only internal links', links.map(l => l.target), [
    'Wiki', 'Embed', 'Path/To', 'Daily/2026-09-01.md', 'assets/pic.png', 'Heading',
  ])
  eq('tags embeds', links.find(l => l.target === 'Embed')?.kind, 'wiki-embed')
  eq('tags images', links.find(l => l.target === 'assets/pic.png')?.kind, 'md-image')
  eq('keeps aliases', links.find(l => l.target === 'Path/To')?.text, 'alias')
  eq('splits the anchor off', links.find(l => l.target === 'Heading')?.hash, '#Anchor')
}

// ------------------------------------------------------------------ rewrite
section('rewriteLinks')
{
  eq('rewrites a wiki target, keeping the alias',
    rewriteLinks('See [[Old|the thing]].', l => (l.target === 'Old' ? 'New' : null)),
    'See [[New|the thing]].')
  eq('keeps the embed marker',
    rewriteLinks('![[Old]]', () => 'New'),
    '![[New]]')
  eq('keeps the anchor',
    rewriteLinks('[[Old#Section]]', () => 'New'),
    '[[New#Section]]')
  eq('wraps a path containing spaces',
    rewriteLinks('[x](old.md)', () => 'My Notes/new.md'),
    '[x](<My Notes/new.md>)')
  eq('leaves untouched links alone',
    rewriteLinks('[[A]] and [[B]]', l => (l.target === 'B' ? 'C' : null)),
    '[[A]] and [[C]]')
}

// ----------------------------------------------------------------- resolver
section('makeResolver')
{
  const r = makeResolver(nodes)
  eq('resolves by exact path', r.resolve('Projects/Ideas/Brainstorm.md', 'Home.md')?.id, id('Projects/Ideas/Brainstorm.md'))
  eq('resolves by path without extension', r.resolve('Projects/Ideas/Brainstorm', 'Home.md')?.id, id('Projects/Ideas/Brainstorm.md'))
  eq('resolves by bare title', r.resolve('Brainstorm', 'Home.md')?.id, id('Projects/Ideas/Brainstorm.md'))
  eq('resolves relative to the source note', r.resolve('../../Home.md', 'Projects/Ideas/Brainstorm.md')?.id, id('Home.md'))
  eq('resolves an asset', r.resolve('assets/pic.png', 'Home.md')?.id, id('assets/pic.png'))
  eq('returns null for a missing target', r.resolve('Nowhere', 'Home.md'), null)
  eq('strict mode refuses the bare-name fallback', r.resolve('Brainstorm', 'Home.md', true), null)
  eq('strict mode still takes an exact path', r.resolve('Projects/Ideas/Brainstorm.md', 'Home.md', true)?.id, id('Projects/Ideas/Brainstorm.md'))
  eq('linkTextFor picks the shortest unambiguous form',
    r.linkTextFor(find('Projects/Ideas/Brainstorm.md'), 'Home.md'), 'Brainstorm')
  eq('relativeTo walks up out of a folder',
    r.relativeTo(find('assets/pic.png'), 'Projects/Ideas/Brainstorm.md'), '../../assets/pic.png')
}

// ------------------------------------------------------------------- paths
section('paths')
{
  eq('relativePath within a folder', relativePath('a/b/note.md', 'a/b/other.md'), 'other.md')
  eq('relativePath up and over', relativePath('a/b/note.md', 'a/assets/x.png'), '../assets/x.png')
  eq('relativePath from the root', relativePath('note.md', 'assets/x.png'), 'assets/x.png')
  eq('relativePath down into a folder', relativePath('note.md', 'a/b/deep.md'), 'a/b/deep.md')
  eq('resolveRelative handles ..', resolveRelative('a/b/note.md', '../c/x.png'), 'a/c/x.png')
  eq('resolveRelative handles ./', resolveRelative('a/note.md', './x.png'), 'a/x.png')
  eq('uniqueName avoids collisions',
    uniqueName([{ name: 'Note.md' } as VaultNode, { name: 'Note 2.md' } as VaultNode], 'Note.md'), 'Note 3.md')
  eq('uniqueName leaves a free name alone', uniqueName([], 'Note.md'), 'Note.md')
}

// -------------------------------------------------------------- retargeting
section('retargetLinks')
{
  // Rename: Brainstorm.md -> Ideation.md
  const renamed = nodes.map(n =>
    n.id === id('Projects/Ideas/Brainstorm.md') ? { ...n, name: 'Ideation.md' } : n)
  const bodies = new Map([
    [id('Home.md'), 'See [[Brainstorm]] and [[Projects/Ideas/Brainstorm|the ideas]].\n'],
    [id('Daily/2026-09-01.md'), 'Code stays put: `[[Brainstorm]]`.\n'],
  ])
  const afterRename = retargetLinks(nodes, renamed, bodies)
  eq('rename updates both link forms',
    afterRename.get(id('Home.md')), 'See [[Ideation]] and [[Ideation|the ideas]].\n')
  eq('rename does not touch links inside code', afterRename.has(id('Daily/2026-09-01.md')), false)

  // Move: Home.md -> Daily/Home.md, so its relative paths shift.
  const moved = nodes.map(n => (n.id === 'Home.md' ? { ...n, parentId: 'Daily' } : n))
  const movedBodies = new Map([
    [id('Home.md'), 'Rel: [log](Daily/2026-09-01.md) and ![p](assets/pic.png) plus [[Brainstorm]].\n'],
  ])
  const afterMove = retargetLinks(nodes, moved, movedBodies)
  eq('move rewrites the note’s own relative paths',
    afterMove.get(id('Home.md')), 'Rel: [log](2026-09-01.md) and ![p](../assets/pic.png) plus [[Brainstorm]].\n')

  // A link that was already broken stays exactly as written.
  const brokenBodies = new Map([[id('Home.md'), 'A [[Ghost]] link.\n']])
  eq('a broken link is left alone', retargetLinks(nodes, renamed, brokenBodies).size, 0)
}

// ------------------------------------------------------------- frontmatter
section('frontmatter & excerpt')
{
  const fm = parseFrontmatter('---\ntitle: Hi\ntags: [a, b]\n---\n\n# Body\n')
  eq('parses scalar keys', fm.data.title, 'Hi')
  eq('parses list keys', fm.data.tags, ['a', 'b'])
  eq('splits the body off', fm.body, '\n# Body\n')
  eq('no frontmatter is a no-op', parseFrontmatter('# Body').raw, '')
  eq('a lone rule is not frontmatter', parseFrontmatter('---\n').body, '---\n')
  eq('excerpt strips markup', excerpt('# Title\n\nSome **bold** [[Link|text]] here.'), 'Title Some bold text here.')
}

// ------------------------------------------------------------- ordering
section('name ordering')
{
  const sorted = (names: string[]) => [...names].sort(compareNames)

  eq('0 before 00 before 1', sorted(['1', '00', '0']), ['0', '00', '1'])
  eq('digits ascend', sorted(['9', '2', '0', '1']), ['0', '1', '2', '9'])
  eq('letters come after digits', sorted(['A', '9', 'a', '0']), ['0', '9', 'a', 'A'])
  eq('A to Z', sorted(['Delta', 'alpha', 'Charlie', 'bravo']),
    ['alpha', 'bravo', 'Charlie', 'Delta'])
  eq('not numeric collation — 10 sorts before 2',
    sorted(['2', '10', '1']), ['1', '10', '2'])
  eq('a prefix sorts before what extends it',
    sorted(['note2', 'note', 'note10']), ['note', 'note10', 'note2'])
  eq('leading zeros are kept distinct', sorted(['1', '01', '001']), ['001', '01', '1'])

  // Ordering is a first-arrival concern: childrenOf trusts `order` after that.
  const node = (id: string, name: string, order: number, parentId: string | null = null) =>
    ({ id, name, parentId, kind: 'note', order, createdAt: 0, updatedAt: 0 }) as VaultNode

  const arranged = [node('a', 'Zebra.md', 0), node('b', 'Apple.md', 1)]
  eq('a hand-made arrangement is respected',
    childrenOf(arranged, null).map(n => n.name), ['Zebra.md', 'Apple.md'])

  const imported = orderNewByName(
    [node('a', 'Zebra.md', 0), node('b', 'Apple.md', 1), node('c', '10.md', 2), node('d', '2.md', 3)],
    ['a', 'b', 'c', 'd'],
  )
  eq('fresh arrivals are numbered by name',
    childrenOf(imported, null).map(n => n.name), ['10.md', '2.md', 'Apple.md', 'Zebra.md'])

  // Importing into a folder someone has arranged must not reshuffle it.
  const mixed = orderNewByName(
    [node('a', 'Zebra.md', 0), node('b', 'Apple.md', 1), node('new2', 'Beta.md', 0), node('new1', 'Alpha.md', 0)],
    ['new1', 'new2'],
  )
  eq('existing entries keep their places, new ones append in name order',
    childrenOf(mixed, null).map(n => n.name), ['Zebra.md', 'Apple.md', 'Alpha.md', 'Beta.md'])

  const nested = orderNewByName(
    [node('p', 'Folder', 0), node('y', 'y.md', 0, 'p'), node('x', 'x.md', 0, 'p')],
    ['p', 'x', 'y'],
  )
  eq('each folder is numbered independently',
    childrenOf(nested, 'p').map(n => n.name), ['x.md', 'y.md'])

  /*
   * An import that adds nothing has to leave the vault exactly as it was. The
   * caller empties its own array and refills it from this return value, so
   * handing back the same reference cleared the array before it could be read
   * and every node in the vault disappeared.
   */
  const untouched = [node('a', 'Kept.md', 0), node('b', 'Also kept.md', 1)]
  const same = orderNewByName(untouched, [])
  eq('nothing new leaves the list intact', same.map(n => n.name), ['Kept.md', 'Also kept.md'])
  eq('nothing new returns a copy, not the caller\'s own array', same !== untouched, true)
  same.length = 0
  eq('clearing the result cannot empty the original', untouched.map(n => n.name),
    ['Kept.md', 'Also kept.md'])
}

// ------------------------------------------------------------- headings
section('headings')
{
  const md = [
    '# Title', '', 'Prose.', '', '## Section A', '', 'More prose.', '',
    '```bash', '# not a heading, it is a shell comment', '```', '',
    '### Deep **bold** and [[Link|alias]]', '',
  ].join('\n')
  const found = headings(md)
  eq('finds headings in document order', found.map(h => h.text),
    ['Title', 'Section A', 'Deep bold and alias'])
  eq('records levels', found.map(h => h.level), [1, 2, 3])
  eq('ignores hashes inside fenced code', found.some(h => h.text.includes('shell')), false)
  eq('ignores headings on later lines of a fenced block',
    headings(['# Real', '', '```', '# fake one', '## fake two', '### fake three', '```'].join('\n')).map(h => h.text),
    ['Real'])
}

// ----------------------------------------------------------------- tldr
section('tldr')
{
  const note = [
    '# Migrating the importer', '',
    'The importer reads a folder and turns it into a note tree.',
    'It preserves folder structure and resolves links between notes.', '',
    '## Performance', '',
    'Large vaults were slow because every note was parsed on each keystroke.',
    'Caching link extraction per note fixed the importer performance problem.',
    'We measured it at about four hundred notes.', '',
    '## Open questions', '',
    'Should the importer skip binary files it cannot preview?',
    'Nobody has decided yet.',
  ].join('\n')

  const result = tldr(note, 3)
  eq('returns the requested number of points', result.points.length, 3)
  eq('keeps points in document order',
    result.points.map(p => p.text).join(' ') === result.points.map(p => p.text).sort(
      (a, b) => note.indexOf(a) - note.indexOf(b)).join(' '), true)
  eq('attributes points to their section',
    result.points.every(p => p.section === null || result.headings.includes(p.section)), true)
  eq('collects headings', result.headings,
    ['Migrating the importer', 'Performance', 'Open questions'])
  eq('strips markdown from the points',
    result.points.every(p => !/[*_`]|\]\(/.test(p.text)), true)
  eq('ignores fenced code',
    tldr('# T\n\n```\nconst reallyDistinctiveToken = 1\n```\n\nA sentence that is long enough to count.', 3)
      .points.some(p => p.text.includes('reallyDistinctiveToken')), false)

  const short = tldr('# Tiny\n\nOne sentence that is definitely long enough to be kept.', 5)
  eq('a short note returns everything it has', short.points.length, 1)
  eq('and reports it considered that many', short.considered, 1)

  eq('an empty note yields nothing', tldr('', 5).points.length, 0)
  eq('a heading-only note yields nothing', tldr('# Just a title', 5).points.length, 0)

  // The most repeated subject should survive a squeeze to a single point.
  const focused = tldr(note, 1)
  eq('the single best point mentions the note subject',
    /importer/i.test(focused.points[0]?.text ?? ''), true)
}

// ------------------------------------------------------------------ tags
section('tags')
{
  const md = [
    '---', 'tags: [alpha, beta]', '---', '',
    '# Title', '', 'Prose with #gamma and #delta/nested in it.', '',
    'A colour `#ff0000` and a `#hashInCode` are not tags.', '',
    '```', '# shell comment', 'color: #abcdef;', '```', '',
    'Trailing #alpha again.',
  ].join('\n')
  const found = tagsIn(md).sort()
  eq('reads frontmatter tags', found.includes('alpha') && found.includes('beta'), true)
  eq('reads inline tags', found.includes('gamma'), true)
  eq('allows nesting', found.includes('delta/nested'), true)
  eq('ignores inline code', found.includes('ff0000') || found.includes('hashInCode'), false)
  eq('ignores fenced code', found.includes('abcdef'), false)
  eq('ignores every line of a fenced block, not just the first',
    tagsIn(['# T', '', '```', 'first #one', 'second #two', 'third #three', '```', '', 'real #tag'].join('\n')).sort(),
    ['tag'])
  eq('does not repeat a tag', found.filter(t => t === 'alpha').length, 1)
  eq('a note with no tags gives nothing', tagsIn('# Just a title'), [])

  // A table of contents is nothing but anchor links. Reading those as tags put
  // one giant "tag" per heading into the sidebar.
  const toc = [
    '# Findings', '',
    '- [P0-API-01 unauthenticated cross tenant event injection](#p0-api-01-unauthenticated-cross-tenant-event-injection)',
    '- [P1-API-02 authorization is copy pasted](#p1-api-02-authorization-is-copy-pasted)',
    '', 'See [the annex](#annex-1-processing-description) for detail. #realtag',
  ].join('\n')
  eq('anchor links are not tags', tagsIn(toc), ['realtag'])

  eq('a url fragment is not a tag',
    tagsIn('Read https://example.com/docs#installation today.'), [])
  eq('a wiki link anchor is not a tag',
    tagsIn('See [[Roadmap#Later]] for more.'), [])
  eq('an image anchor is not a tag',
    tagsIn('![alt](assets/pic.png#frag)'), [])
  eq('a heading id is not a tag', tagsIn('## Title {#custom-id}'), [])
  eq('an html entity is not a tag', tagsIn('Dashes &#8212; like this.'), [])
  eq('a tag glued to a word is not a tag', tagsIn('issue#42 and abc#def'), [])
  eq('a tag at the start of a line still counts', tagsIn('#top of the note'), ['top'])
  eq('a tag in a list item still counts', tagsIn('- #listed item here'), ['listed'])
}

// ---------------------------------------------------------- tldr quality
section('tldr quality')
{
  // Three ways of saying the same thing, plus two distinct points. A good
  // summary picks one of the repeats, not all three.
  const repetitive = [
    '# Caching', '',
    'The cache stores parsed links so the parser does not run twice.',
    'Parsed links are kept in the cache to avoid running the parser twice.',
    'We keep parsed links cached so that the parser is not run twice over.', '',
    '## Storage', '',
    'Everything is written to IndexedDB on the local device only.', '',
    '## Limits', '',
    'The graph view becomes cluttered beyond a few thousand notes.',
  ].join('\n')

  const summary = tldr(repetitive, 3)
  eq('returns the asked-for number of points', summary.points.length, 3)

  const mentionsCache = summary.points.filter(p => /cache|cached/i.test(p.text)).length
  eq('does not repeat one idea across every point', mentionsCache <= 2, true)
  eq('covers more than one section',
    new Set(summary.points.map(p => p.section)).size > 1, true)

  const order = summary.points.map(p => repetitive.indexOf(p.text.slice(0, 24)))
  eq('points stay in document order',
    order.every((v, i) => i === 0 || v >= order[i - 1]), true)

  eq('never returns more than it was asked for', tldr(repetitive, 1).points.length, 1)
  eq('is stable across runs',
    JSON.stringify(tldr(repetitive, 3).points) === JSON.stringify(tldr(repetitive, 3).points), true)
}

// ------------------------------------------------------------------ intake
section('what a book accepts')
{
  const accepted = ['a.md', 'p.png', 'p.jpg', 'p.jpeg', 'p.webp', 'p.avif', 'p.gif', 'p.svg', 'v.mp4']
  const refused = ['a.txt', 'a.markdown', 'a.mdx', 'd.pdf', 's.xlsx', 'v.mov', 'v.webm', 'a.mp3', 'x.exe', 'noext']
  eq('takes markdown, pictures and mp4', accepted.filter(n => !isAccepted(n)), [])
  eq('refuses everything else', refused.filter(n => isAccepted(n)), [])
  eq('is case-insensitive', isAccepted('PHOTO.PNG') && isAccepted('NOTE.MD'), true)

  const file = (path: string) => ({ path, file: new File([''], path.split('/').pop() ?? path) })

  const mixed = screenFiles([
    file('book/Note.md'), file('book/photo.png'), file('book/report.pdf'),
    file('book/sheet.xlsx'), file('book/deep/Sub.md'),
  ])
  eq('keeps supported files', mixed.files.map(f => f.path).sort(),
    ['book/Note.md', 'book/deep/Sub.md', 'book/photo.png'])
  eq('reports what it refused', mixed.rejected.sort(), ['report.pdf', 'sheet.xlsx'])
  eq('is not empty when markdown is present', mixed.empty, false)

  // A folder with no markdown anywhere beneath it does not come in.
  const photosOnly = screenFiles([file('photos/a.png'), file('photos/b.jpg')])
  eq('a folder with no markdown imports nothing', photosOnly.files.length, 0)
  eq('and says so', photosOnly.empty, true)

  // An assets folder beside notes still arrives, because markdown is above it.
  const withAssets = screenFiles([
    file('book/Note.md'), file('book/assets/pic.png'), file('book/assets/clip.mp4'),
  ])
  eq('an assets folder beside notes comes along',
    withAssets.files.map(f => f.path).sort(),
    ['book/Note.md', 'book/assets/clip.mp4', 'book/assets/pic.png'])

  // A top-level folder with no markdown is left out; its siblings are kept.
  const pruned = screenFiles([
    file('Root.md'), file('junk/a.png'), file('notes/Deep.md'),
  ])
  eq('a top-level folder with no markdown is left out',
    pruned.files.map(f => f.path).sort(), ['Root.md', 'notes/Deep.md'])
  eq('and is named in the report', pruned.prunedFolders, ['junk'])

  eq('markdown nested deep qualifies its ancestors',
    screenFiles([file('a/b/c/Deep.md'), file('a/b/pic.png')]).files.map(f => f.path).sort(),
    ['a/b/c/Deep.md', 'a/b/pic.png'])

  eq('dot-folders are ignored', screenFiles([file('.git/config.md')]).files.length, 0)
  eq('nothing at all is empty', screenFiles([]).empty, true)
}

// -------------------------------------------------------------- encryption
async function checkCrypto() {
  section('encryption')

  const { key, lock } = await createLock('correct horse battery staple')

  eq('the lock keeps no copy of the password',
    JSON.stringify(lock).includes('correct horse'), false)
  eq('the salt is 16 bytes', lock.salt.length, 16)
  eq('a real iteration count is recorded', lock.iterations >= 100000, true)

  const secret = '# Private\n\nSomething I would rather keep.\n'
  const sealed = await encrypt(key, secret)
  eq('ciphertext does not contain the plaintext',
    new TextDecoder().decode(new Uint8Array(sealed.data)).includes('rather keep'), false)
  eq('the right key reads it back', await decrypt(key, sealed), secret)

  const right = await unlockKey('correct horse battery staple', lock)
  eq('the right password derives a usable key', right !== null, true)
  eq('and that key decrypts', right && (await decrypt(right, sealed)), secret)

  eq('a wrong password is rejected', await unlockKey('correct horse battery stapl', lock), null)
  eq('an empty password is rejected', await unlockKey('', lock), null)

  const other = await createLock('correct horse battery staple')
  eq('the same password with a fresh salt gives a different key',
    await decrypt(other.key, sealed), null)
  eq('each lock has its own salt',
    JSON.stringify(lock.salt) === JSON.stringify(other.lock.salt), false)

  // AES-GCM authenticates, which is what makes a wrong key fail rather than
  // quietly returning rubbish.
  const tampered = { ...sealed, data: [...sealed.data] }
  tampered.data[4] = (tampered.data[4] + 1) % 256
  eq('tampered ciphertext is refused', await decrypt(key, tampered), null)

  const twice = await encrypt(key, secret)
  eq('the same text encrypts differently each time',
    JSON.stringify(twice.data) === JSON.stringify(sealed.data), false)
  eq('and both still decrypt', await decrypt(key, twice), secret)

  eq('an empty note round-trips', await decrypt(key, await encrypt(key, '')), '')
  const unicode = 'héllo 世界 🐬\n\ttabs and "quotes"'
  eq('unicode round-trips', await decrypt(key, await encrypt(key, unicode)), unicode)

  eq('a short password is called out', passwordStrength('abc').score, 0)
  eq('a long one is not', passwordStrength('a-much-longer-passphrase').score, 3)

  finish()
}

function finish() {
const summary = document.createElement('h1')
summary.className = failures ? 'fail' : 'pass'
summary.id = 'summary'
summary.textContent = failures ? `${failures} check(s) failed` : 'All checks passed'
out.append(summary)
}

void checkCrypto()
