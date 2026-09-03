import { React, type AllWidgetProps, UrlManager, getAppStore } from 'jimu-core'
import './style.css'

type NavItem = {
  label: string
  pageId: string
  pageLabel: string
  matchStartsWith?: boolean
}

const HOME_PAGE_ID = 'page_45'
const PORTAL_SITE_URL = 'https://portaldaagua.sihs.ba.gov.br/'

const NAV_ITEMS: NavItem[] = [
  { label: 'Início', pageId: HOME_PAGE_ID, pageLabel: 'Ínicio' },
  { label: 'Infraestrutura', pageId: 'page_41', pageLabel: 'Infraestrutura Hídrica' },
  { label: 'Abastecimento', pageId: 'page_39', pageLabel: 'Abastecimento de Água' },
  { label: 'Esgotamento', pageId: 'page_40', pageLabel: 'Esgotamento Sanitário' },
  { label: 'Atlas', pageId: 'page_52', pageLabel: 'Atlas', matchStartsWith: true },
  { label: 'Sobre', pageId: 'page_54', pageLabel: 'Sobre', matchStartsWith: true }
]

const findPageIdByLabel = (label: string, matchStartsWith = false): string | undefined => {
  const pages = getAppStore().getState()?.appConfig?.pages
  if (!pages) return undefined
  const target = label.trim().toLowerCase()
  return Object.keys(pages).find((id) => {
    const pageLabel = (pages[id].label || '').trim().toLowerCase()
    return matchStartsWith
      ? pageLabel === target || pageLabel.startsWith(target)
      : pageLabel === target
  })
}

const resolvePageId = (item: NavItem): string => {
  return findPageIdByLabel(item.pageLabel, item.matchStartsWith) || item.pageId
}

const getCurrentPageId = (): string | undefined => {
  const state = getAppStore().getState() as any
  return (
    state?.appRuntimeInfo?.currentPageId ||
    state?.queryObject?.page ||
    undefined
  )
}

const scrollPageToTop = () => {
  const preferSmooth =
    typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = preferSmooth ? 'smooth' : 'auto'

  window.scrollTo({ top: 0, left: 0, behavior })
  document.documentElement.scrollTo?.({ top: 0, left: 0, behavior })
  document.body.scrollTo?.({ top: 0, left: 0, behavior })

  const selectors = [
    '.sihs-page',
    '.infra-page',
    '.abas-page',
    '.esgo-page',
    '.atlas-page',
    '.sobre-page',
    '.jimu-main',
    '.exb-application',
    '.widget-content',
    '[class*="page-content"]',
    '[class*="PageContent"]',
    'main'
  ]

  document.querySelectorAll(selectors.join(',')).forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    if (node.scrollHeight > node.clientHeight + 8) {
      node.scrollTo({ top: 0, left: 0, behavior })
    }
  })
}

const Widget = (props: AllWidgetProps<any>) => {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [menuTop, setMenuTop] = React.useState(72)
  const [currentPageId, setCurrentPageId] = React.useState<string | undefined>(
    () => getCurrentPageId() || (props.queryObject?.page as string | undefined)
  )
  const rootRef = React.useRef<HTMLDivElement>(null)

  const portalLogoUrl = `${props.context.folderUrl}dist/runtime/assets/portal.png`
  const brasaoUrl = `${props.context.folderUrl}dist/runtime/assets/brasao.png`

  const updateMenuPosition = React.useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenuTop(Math.max(rect.bottom, 0))
  }, [])

  React.useEffect(() => {
    if (!menuOpen) return
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [menuOpen, updateMenuPosition])

  React.useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  React.useEffect(() => {
    const store = getAppStore()
    const syncPage = () => {
      const pageId = getCurrentPageId() || (props.queryObject?.page as string | undefined)
      setCurrentPageId((prev) => (prev === pageId ? prev : pageId))
    }
    syncPage()
    return store.subscribe(syncPage)
  }, [props.queryObject?.page])

  const goToPage = (item: NavItem) => {
    UrlManager.getInstance().changePage(resolvePageId(item))
    setMenuOpen(false)
    requestAnimationFrame(() => scrollPageToTop())
  }

  const goHome = () => {
    const pageId =
      findPageIdByLabel('Ínicio') ||
      findPageIdByLabel('Início') ||
      findPageIdByLabel('Inicio') ||
      HOME_PAGE_ID
    UrlManager.getInstance().changePage(pageId)
    setMenuOpen(false)
    requestAnimationFrame(() => scrollPageToTop())
    setTimeout(scrollPageToTop, 120)
  }

  const isActive = (item: NavItem) => {
    const resolved = resolvePageId(item)
    return currentPageId === resolved || currentPageId === item.pageId
  }

  const toggleMenu = () => {
    setMenuOpen((open) => {
      const next = !open
      if (next) {
        requestAnimationFrame(updateMenuPosition)
      }
      return next
    })
  }

  const renderLinks = (mobile = false) =>
    NAV_ITEMS.map((item) => (
      <button
        key={`${mobile ? 'm' : 'd'}-${item.pageId}`}
        type="button"
        className={`hp-header__link${isActive(item) ? ' is-active' : ''}`}
        onClick={() => (item.pageId === HOME_PAGE_ID ? goHome() : goToPage(item))}
        aria-current={isActive(item) ? 'page' : undefined}
      >
        {mobile && item.label === 'Infraestrutura'
          ? 'Infraestrutura Hídrica'
          : mobile && item.label === 'Abastecimento'
            ? 'Abastecimento de Água'
            : mobile && item.label === 'Esgotamento'
              ? 'Esgotamento Sanitário'
              : item.label}
      </button>
    ))

  return (
    <div
      className="hp-header jimu-widget"
      ref={rootRef}
    >
      <header className="hp-header__bar">
        <div className="hp-header__brand">
          <a
            className="hp-header__logos"
            href={PORTAL_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir Portal da Água"
            title="Portal da Água"
          >
            <img
              className="hp-header__portal"
              src={portalLogoUrl}
              alt="Portal da Água"
            />
            <img
              className="hp-header__brasao"
              src={brasaoUrl}
              alt="Brasão do Estado da Bahia"
            />
          </a>
          <span className="hp-header__divider" aria-hidden="true" />
          <button
            type="button"
            className="hp-header__titles-btn"
            onClick={goHome}
            aria-label="Voltar para a tela inicial"
            title="Voltar para a tela inicial"
          >
            <span className="hp-header__titles">
              <span className="hp-header__eyebrow">Secretaria de</span>
              <span className="hp-header__title">Infraestrutura Hídrica e Saneamento</span>
            </span>
          </button>
        </div>

        <nav className="hp-header__nav" aria-label="Navegação principal">
          {renderLinks(false)}
        </nav>

        <button
          type="button"
          className={`hp-header__menu-btn${menuOpen ? ' is-open' : ''}`}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          <span />
        </button>
      </header>

      {menuOpen && (
        <>
          <button
            type="button"
            className="hp-header__backdrop"
            aria-label="Fechar menu"
            onClick={() => setMenuOpen(false)}
            style={{ top: menuTop }}
          />
          <nav
            className="hp-header__mobile is-open"
            aria-label="Navegação mobile"
            style={{ top: menuTop }}
          >
            {renderLinks(true)}
          </nav>
        </>
      )}
    </div>
  )
}

export default Widget
