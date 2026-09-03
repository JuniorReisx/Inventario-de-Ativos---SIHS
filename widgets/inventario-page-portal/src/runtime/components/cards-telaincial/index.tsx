import { React, UrlManager, getAppStore } from 'jimu-core'
import './style.css'

type CardDefinition = {
  id: string
  tag: string
  title: React.ReactNode
  text: string
  image: string
  pageId: string
  pageLabel: string
  matchStartsWith?: boolean
}

const CARDS: CardDefinition[] = [
  {
    id: 'infraestrutura-hidrica',
    tag: 'Infraestrutura',
    title: (
      <>
        Infraestrutura
        <br />
        Hídrica
      </>
    ),
    text: 'Obras, sistemas e equipamentos para captar, armazenar, tratar e distribuir água à população, à agricultura, à indústria e à geração de energia.',
    image: 'infra.jpg',
    pageId: 'page_41',
    pageLabel: 'Infraestrutura Hídrica'
  },
  {
    id: 'abastecimento-agua',
    tag: 'Água',
    title: (
      <>
        Abastecimento
        <br />
        de Água
      </>
    ),
    text: 'Sistemas de captação, tratamento, armazenamento e distribuição de água potável com qualidade e continuidade para a população.',
    image: 'abas.jpg',
    pageId: 'page_39',
    pageLabel: 'Abastecimento de Água'
  },
  {
    id: 'esgotamento-sanitario',
    tag: 'Esgoto',
    title: (
      <>
        Esgotamento
        <br />
        Sanitário
      </>
    ),
    text: 'Coleta, transporte, tratamento e destinação adequada do esgoto para proteger a saúde pública e os recursos hídricos.',
    image: 'esgo.jpg',
    pageId: 'page_40',
    pageLabel: 'Esgotamento Sanitário'
  },
  {
    id: 'atlas',
    tag: 'Mapas',
    title: 'Atlas',
    text: 'Mapas e dados territoriais sobre infraestrutura hídrica, abastecimento e esgotamento para consulta e apoio à decisão.',
    image: 'atlas.jpg',
    pageId: 'page_52',
    pageLabel: 'Atlas',
    matchStartsWith: true
  }
]

const ArrowIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8h9M8.5 3.5 13 8l-4.5 4.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

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

const finePointer = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

type NavCardProps = {
  card: CardDefinition
  folderUrl: string
  isVisible: boolean
  isActive: boolean
  onToggleActive: () => void
  delayMs: number
}

const NavCard = ({
  card,
  folderUrl,
  isVisible,
  isActive,
  onToggleActive,
  delayMs
}: NavCardProps) => {
  const mediaRef = React.useRef<HTMLDivElement>(null)
  const imageUrl = `${folderUrl}dist/runtime/assets/${card.image}`

  const goToPage = () => {
    const pageId =
      findPageIdByLabel(card.pageLabel, card.matchStartsWith) || card.pageId
    UrlManager.getInstance().changePage(pageId)
  }

  const onCardClick = () => {
    if (finePointer()) {
      goToPage()
      return
    }
    if (isActive) {
      goToPage()
      return
    }
    onToggleActive()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion() || !finePointer() || !mediaRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    mediaRef.current.style.transform = `scale(1.12) translate(${x * 8}px, ${y * 8}px)`
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`ih-card${isVisible ? ' is-visible' : ''}${isActive ? ' is-active' : ''}`}
      style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCardClick()
        }
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        if (mediaRef.current) mediaRef.current.style.transform = ''
      }}
    >
      <div
        ref={mediaRef}
        className="ih-card__media"
        style={{ backgroundImage: `url('${imageUrl}')` }}
      />
      <div className="ih-card__overlay" />
      <div className="ih-card__glow" aria-hidden="true" />
      <div className="ih-card__content">
        <div className="ih-card__top">
          <span className="ih-card__tag">{card.tag}</span>
        </div>
        <h2 className="ih-card__title">{card.title}</h2>
        <p className="ih-card__text">{card.text}</p>
        <span className="ih-card__btn" aria-hidden="true">
          Acessar
          <ArrowIcon />
        </span>
      </div>
      <div className="ih-card__sheen" aria-hidden="true" />
    </div>
  )
}

const CardsTelaInicial = ({ folderUrl }: { folderUrl: string }) => {
  const [isVisible, setIsVisible] = React.useState(false)
  const [activeId, setActiveId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className={`ih-cards-widget${isVisible ? ' is-visible' : ''}`}>
      <section className="ih-cards-section" aria-labelledby="ih-cards-heading">
        <header className="ih-cards-head">
          <h2 className="ih-cards-title" id="ih-cards-heading">
            Aplicações
          </h2>
          <span className="ih-cards-accent" aria-hidden="true" />
          <p className="ih-cards-subtitle">
            Acesse serviços e aplicações do Observatório
          </p>
        </header>

        <div className="ih-cards-grid" role="list">
          {CARDS.map((card, index) => (
            <div key={card.id} className="ih-cards-grid__item" role="listitem">
              <NavCard
                card={card}
                folderUrl={folderUrl}
                isVisible={isVisible}
                isActive={activeId === card.id}
                onToggleActive={() =>
                  setActiveId((prev) => (prev === card.id ? null : card.id))
                }
                delayMs={120 + index * 80}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default CardsTelaInicial
