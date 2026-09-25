// Downloads the two families from Google once, so the app can stop asking
// Google for them on every visit. Only latin + latin-ext: that is what
// Turkish needs (ğ ş ı ö ü ç).
import { mkdirSync, writeFileSync } from 'node:fs'

const here = new URL('.', import.meta.url)
const OUT = new URL('../public/fonts/', here).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Instrument+Sans:wght@400;500;600&display=swap'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

mkdirSync(OUT, { recursive: true })
const css = await (await fetch(CSS_URL, { headers: { 'user-agent': UA } })).text()

// Each @font-face block, with the subset name from the comment above it.
const blocks = [...css.matchAll(/\/\* (\S+) \*\/\s*@font-face \{([^}]+)\}/g)].map(([, subset, body]) => ({
  subset,
  family: /font-family: '([^']+)'/.exec(body)[1],
  weight: /font-weight: (\d+)/.exec(body)[1],
  url: /src: url\(([^)]+)\)/.exec(body)[1],
  range: /unicode-range: ([^;]+);/.exec(body)[1],
}))

const wanted = blocks.filter((b) => b.subset === 'latin' || b.subset === 'latin-ext')
const rules = []
for (const b of wanted) {
  const slug = `${b.family.toLowerCase().replace(/\s+/g, '-')}-${b.weight}-${b.subset}`
  const bytes = Buffer.from(await (await fetch(b.url, { headers: { 'user-agent': UA } })).arrayBuffer())
  writeFileSync(`${OUT}/${slug}.woff2`, bytes)
  console.log(`${slug}.woff2  ${(bytes.length / 1024).toFixed(1)} kB`)
  rules.push(`/* ${b.family} ${b.weight}, ${b.subset} */
@font-face {
  font-family: '${b.family}';
  font-style: normal;
  font-weight: ${b.weight};
  font-display: swap;
  src: url('/fonts/${slug}.woff2') format('woff2');
  unicode-range: ${b.range};
}`)
}

writeFileSync(
  new URL('../src/fonts.css', here).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  `/* Fraunces (headings) and Instrument Sans (text), served by us instead of
   Google's CDN: one less third party, and they keep working offline once the
   service worker has them. Only latin + latin-ext are bundled — enough for
   Turkish. Regenerate with scratchpad/fetch-fonts.mjs. */

${rules.join('\n\n')}
`,
)
console.log(`\n${wanted.length} files, ${rules.length} @font-face rules -> web/src/fonts.css`)
