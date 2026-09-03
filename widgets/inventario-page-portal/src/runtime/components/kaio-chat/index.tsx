import { React } from 'jimu-core'
import './style.css'

const { useEffect, useRef, useState } = React

const DEFAULT_API_URL = 'https://sihs-ia-inventario.onrender.com/api/chat'
const WELCOME =
  'Olá! Eu sou o Gil, seu assistente virtual na SIHS. Posso te ajudar com recursos hídricos da Bahia: infraestrutura, abastecimento, esgotamento e o que você vê neste portal. Como posso ajudar?'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function TypingDots () {
  return (
    <div className="kaio-chat__dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function GilProfile (props: {
  photo: string
  onClose: () => void
}) {
  return (
    <div className="kaio-chat__profile" role="dialog" aria-label="Perfil do Gil">
      <button type="button" className="kaio-chat__profile-close" aria-label="Fechar perfil" onClick={props.onClose}>
        ×
      </button>
      <div className="kaio-chat__profile-hero">
        <img src={props.photo} alt="Gil" />
        <span className="kaio-chat__profile-live">Online agora</span>
      </div>
      <div className="kaio-chat__profile-body">
        <p className="kaio-chat__profile-kicker">Assistente virtual</p>
        <h3>Gil</h3>
        <p className="kaio-chat__profile-bio">
          Seu guia no Portal da Água da SIHS. Ajudo a navegar o inventário, o atlas e os mapas
          da Bahia — sempre apontando para o que está no portal, sem inventar número.
        </p>
        <ul className="kaio-chat__profile-facts">
          <li><strong>Base</strong> Salvador · Bahia</li>
          <li><strong>Missão</strong> Deixar a água mais fácil de entender</li>
          <li><strong>Especialidade</strong> Mapas, municípios e sistemas hídricos</li>
          <li><strong>Estilo</strong> Direto, educado e com os pés no dado oficial</li>
        </ul>
        <div className="kaio-chat__profile-tags">
          <span>Infraestrutura</span>
          <span>Abastecimento</span>
          <span>Esgotamento</span>
          <span>Atlas</span>
        </div>
        <button type="button" className="kaio-chat__profile-back" onClick={props.onClose}>
          Falar com o Gil
        </button>
      </div>
    </div>
  )
}

export default function KaioChat (props: {
  folderUrl: string
  apiUrl?: string
}) {
  const photo = `${props.folderUrl}dist/runtime/assets/kaio.jpg`
  const apiUrl = String(props.apiUrl || DEFAULT_API_URL).trim() || DEFAULT_API_URL
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(false)
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: WELCOME }
  ])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open && !profile) window.setTimeout(() => inputRef.current?.focus(), 120)
  }, [open, profile])

  const resetChat = () => {
    setMessages([{ role: 'assistant', content: WELCOME }])
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const data = await res.json()
      const reply = String(data?.response || data?.message || data?.reply || '').trim()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: reply || 'Não consegui montar uma resposta agora. Tente de novo em instantes.' }
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Não foi possível conectar ao assistente: ${(err as Error)?.message || 'erro de rede'}.`
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const openProfile = (event?: React.MouseEvent) => {
    event?.stopPropagation()
    setOpen(true)
    setProfile(true)
  }

  return (
    <div className={`kaio-chat${open ? ' is-open' : ''}${profile ? ' is-profile' : ''}`}>
      <button
        type="button"
        className="kaio-chat__fab"
        aria-expanded={open}
        aria-controls="kaio-chat-panel"
        aria-label={open ? 'Fechar o Gil' : 'Abrir o Gil, assistente virtual da SIHS'}
        onClick={() => {
          setProfile(false)
          setOpen((value) => !value)
        }}
      >
        {open
          ? (
            <svg className="kaio-chat__fab-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            )
          : (
            <svg className="kaio-chat__fab-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.2 5.2h9.6A3.8 3.8 0 0 1 20.6 9v6.2a3.8 3.8 0 0 1-3.8 3.8H11l-3.8 3.2v-3.2H7.2A3.8 3.8 0 0 1 3.4 15.2V9A3.8 3.8 0 0 1 7.2 5.2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M8 10.2h8M8 13.4h5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            )}
      </button>

      <section
        id="kaio-chat-panel"
        className="kaio-chat__panel"
        hidden={!open}
        aria-label="Conversa com o Gil"
      >
        {profile
          ? <GilProfile photo={photo} onClose={() => setProfile(false)} />
          : null}

        <header className="kaio-chat__head">
          <button type="button" className="kaio-chat__avatar-btn" onClick={openProfile} title="Ver perfil do Gil">
            <img src={photo} alt="Gil" className="kaio-chat__avatar" />
          </button>
          <div>
            <p className="kaio-chat__name">Gil</p>
            <p className="kaio-chat__role">Seu assistente virtual na SIHS</p>
          </div>
          <button type="button" className="kaio-chat__clear" onClick={resetChat} title="Limpar conversa">
            Nova conversa
          </button>
        </header>

        <div className="kaio-chat__messages">
          {messages.map((msg, index) => (
            <div
              key={`${msg.role}-${index}`}
              className={`kaio-chat__row kaio-chat__row--${msg.role}`}
            >
              {msg.role === 'assistant'
                ? (
                  <button type="button" className="kaio-chat__avatar-btn" onClick={openProfile} title="Ver perfil do Gil">
                    <img src={photo} alt="Gil" className="kaio-chat__bubble-avatar" />
                  </button>
                  )
                : null}
              <div className="kaio-chat__bubble">{msg.content}</div>
            </div>
          ))}
          {loading
            ? (
              <div className="kaio-chat__row kaio-chat__row--assistant">
                <button type="button" className="kaio-chat__avatar-btn" onClick={openProfile} title="Ver perfil do Gil">
                  <img src={photo} alt="Gil" className="kaio-chat__bubble-avatar" />
                </button>
                <div className="kaio-chat__bubble kaio-chat__bubble--typing">
                  <TypingDots />
                </div>
              </div>
              )
            : null}
          <div ref={bottomRef} />
        </div>

        <div className="kaio-chat__composer">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            disabled={loading}
            placeholder="Pergunte sobre recursos hídricos…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKey}
          />
          <button
            type="button"
            className="kaio-chat__send"
            disabled={loading || !input.trim()}
            aria-label="Enviar"
            onClick={() => { void sendMessage() }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  )
}
