const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const srcJs = path.join(root, 'js', 'painel.js')
const srcCss = path.join(root, 'css', 'painel.css')
const outJs = path.join(root, 'src', 'runtime', 'lib', 'painel.js')
const outCss = path.join(root, 'src', 'runtime', 'components', 'painel-esgoto', 'style.css')

function transformPainelJs (source) {
  let body = source
    .replace(/^const GEO = window\.GEO_DATA;\s*/m, '')
    .replace(/window\.PTS_DATA/g, 'PTS_DATA')
    .replace(/document\.addEventListener\('click'[\s\S]*?document\.addEventListener\('keydown'[\s\S]*?\}\);\s*/, '')
    .replace(/document\.getElementById\(/g, "qs('#'+")
    .replace(/document\.querySelectorAll\(/g, 'qsa(')
    .replace(/document\.querySelector\(/g, 'qs(')

  body = body.replace(/\n/g, '\n  ')

  return `/* Generated from js/painel.js — do not edit by hand. */
export function initPainelEsgoto (root, GEO, PTS_DATA) {
  if (!root || !GEO) return () => {}

  const qs = (sel) => root.querySelector(sel)
  const qsa = (sel) => Array.from(root.querySelectorAll(sel))

${body}

  function onDocClick (e) {
    const tip = e.target.closest('.info-tip')
    qsa('.info-tip.is-open').forEach(el => {
      if (el !== tip) el.classList.remove('is-open')
    })
    if (tip && root.contains(tip)) {
      e.preventDefault()
      tip.classList.toggle('is-open')
    }
  }

  function onDocKeyDown (e) {
    if (e.key === 'Escape') {
      closeAglomeradosModal()
      qsa('.info-tip.is-open').forEach(el => el.classList.remove('is-open'))
    }
  }

  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeyDown)

  return function destroy () {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKeyDown)
    clearTimeout(touchHintTimer)
    if (mapSvgEl && mapSvgEl.parentElement) mapSvgEl.parentElement.removeChild(mapSvgEl)
  }
}
`
}

function prefixSelectors (selectors, prefix) {
  return selectors.split(',').map((raw) => {
    const sel = raw.trim()
    if (!sel) return sel
    if (sel.startsWith('@')) return sel
    if (sel.includes(prefix)) return sel
    if (sel === ':root' || sel.startsWith(':root')) return sel.replace(':root', prefix)
    if (sel === 'body' || sel.startsWith('body ') || sel.startsWith('body.') || sel.startsWith('body:')) {
      return sel.replace(/^body/, prefix)
    }
    if (sel === '*') return `${prefix}, ${prefix} *`
    return `${prefix} ${sel}`
  }).join(', ')
}

function transformCss (source, prefix) {
  let i = 0
  let out = ''
  while (i < source.length) {
    const ch = source[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      out += ch
      i++
      continue
    }
    if (source.startsWith('/*', i)) {
      const commentEnd = source.indexOf('*/', i)
      const end = commentEnd < 0 ? source.length : commentEnd + 2
      out += source.slice(i, end)
      i = end
      continue
    }
    if (source.startsWith('@import', i) || source.startsWith('@charset', i)) {
      const endQuote = source.indexOf("');", i)
      const endQuote2 = source.indexOf('");', i)
      const endPlain = source.indexOf(';', i)
      const candidates = [endQuote, endQuote2].filter((n) => n >= 0)
      const end = candidates.length ? Math.min(...candidates) + 2 : endPlain
      out += source.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (source.startsWith('@keyframes', i) || source.startsWith('@-webkit-keyframes', i)) {
      const brace = source.indexOf('{', i)
      let depth = 1
      let j = brace + 1
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth++
        else if (source[j] === '}') depth--
        j++
      }
      out += source.slice(i, j)
      i = j
      continue
    }
    if (source.startsWith('@media', i) || source.startsWith('@supports', i)) {
      const brace = source.indexOf('{', i)
      out += source.slice(i, brace + 1)
      i = brace + 1
      let depth = 1
      let innerStart = i
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') depth--
        i++
      }
      const inner = source.slice(innerStart, i - 1)
      out += transformCss(inner, prefix)
      out += '}'
      continue
    }
    const brace = source.indexOf('{', i)
    if (brace === -1) {
      out += source.slice(i)
      break
    }
    const selectors = source.slice(i, brace)
    let depth = 1
    let j = brace + 1
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth++
      else if (source[j] === '}') depth--
      j++
    }
    const body = source.slice(brace, j)
    out += prefixSelectors(selectors, prefix) + body
    i = j
  }
  return out
}

function wrapCss (source) {
  const prefixed = transformCss(source, '.esgo-painel')
  return `/* Generated from css/painel.css — scoped to .esgo-painel */\n${prefixed}

.esgo-painel {
  position: relative;
  width: 100%;
}

.esgo-painel__loading,
.esgo-painel__error {
  margin: 12px 24px 0;
  padding: 14px 16px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e4eaee;
  color: #4f6470;
  font-size: 14px;
}

.esgo-painel__error {
  color: #b42318;
}
`
}

const js = transformPainelJs(fs.readFileSync(srcJs, 'utf8'))
const css = wrapCss(fs.readFileSync(srcCss, 'utf8'))

fs.mkdirSync(path.dirname(outJs), { recursive: true })
fs.mkdirSync(path.dirname(outCss), { recursive: true })
fs.writeFileSync(outJs, js)
fs.writeFileSync(outCss, css)
console.log('Wrote', path.relative(root, outJs), js.length, 'bytes')
console.log('Wrote', path.relative(root, outCss), css.length, 'bytes')
