import { React } from 'jimu-core'
import './style.css'

type Particle = {
  x: number
  y: number
  r: number
  speed: number
  drift: number
  alpha: number
  twinkle: number
}

type Ripple = {
  x: number
  y: number
  r: number
  max: number
  alpha: number
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const HeroAbastecimento = () => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let width = 0
    let height = 0
    let dpr = 1
    let t = 0
    let particles: Particle[] = []
    let ripples: Ripple[] = []
    let running = true
    let pointerX = 0.35
    let pointerY = 0.4
    let targetX = 0.35
    let targetY = 0.4
    let rippleTimer = 0

    const createParticles = (count: number) => {
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 2.6,
        speed: 0.12 + Math.random() * 0.42,
        drift: (Math.random() - 0.5) * 0.4,
        alpha: 0.18 + Math.random() * 0.45,
        twinkle: Math.random() * Math.PI * 2
      }))
    }

    const spawnRipple = () => {
      ripples.push({
        x: width * (0.2 + Math.random() * 0.65),
        y: height * (0.25 + Math.random() * 0.45),
        r: 4,
        max: 60 + Math.random() * 90,
        alpha: 0.28
      })
      if (ripples.length > 5) ripples.shift()
    }

    const resize = () => {
      const rect = root.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      createParticles(Math.max(36, Math.floor((width * height) / 15000)))
    }

    const drawWave = (
      yBase: number,
      amp: number,
      freq: number,
      speed: number,
      color: string,
      phase: number
    ) => {
      ctx.beginPath()
      ctx.moveTo(0, height)
      for (let x = 0; x <= width; x += 3) {
        const y =
          yBase +
          Math.sin(x * freq + t * speed + phase) * amp +
          Math.sin(x * freq * 0.45 - t * speed * 0.7 + phase) * (amp * 0.35)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    }

    const drawStatic = () => {
      const g = ctx.createLinearGradient(0, 0, width, 0)
      g.addColorStop(0, '#2fc4ff')
      g.addColorStop(0.28, '#0a7fa8')
      g.addColorStop(0.72, '#002231')
      g.addColorStop(1, '#001824')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)
      drawWave(height * 0.58, 18, 0.008, 0, 'rgba(94, 200, 222, 0.28)', 0)
      drawWave(height * 0.68, 22, 0.01, 0, 'rgba(10, 127, 168, 0.32)', 1.2)
      drawWave(height * 0.78, 16, 0.012, 0, 'rgba(0, 34, 49, 0.28)', 2.1)
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      targetX = (event.clientX - rect.left) / rect.width
      targetY = (event.clientY - rect.top) / rect.height
    }

    const drawFrame = () => {
      if (!running) return

      pointerX += (targetX - pointerX) * 0.05
      pointerY += (targetY - pointerY) * 0.05

      const g = ctx.createLinearGradient(0, 0, width, 0)
      g.addColorStop(0, '#2fc4ff')
      g.addColorStop(0.28, '#0a7fa8')
      g.addColorStop(0.72, '#002231')
      g.addColorStop(1, '#001824')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)

      const bloomX = width * (0.12 + pointerX * 0.28)
      const bloomY = height * (0.35 + pointerY * 0.2)
      const bloom = ctx.createRadialGradient(
        bloomX,
        bloomY,
        16,
        bloomX,
        bloomY,
        Math.max(width, height) * 0.55
      )
      bloom.addColorStop(0, 'rgba(47, 196, 255, 0.55)')
      bloom.addColorStop(0.35, 'rgba(94, 200, 222, 0.22)')
      bloom.addColorStop(1, 'rgba(47, 196, 255, 0)')
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, width, height)

      const bloom2 = ctx.createRadialGradient(
        width * 0.82,
        height * 0.7,
        10,
        width * 0.82,
        height * 0.7,
        width * 0.4
      )
      bloom2.addColorStop(0, 'rgba(239, 247, 252, 0.12)')
      bloom2.addColorStop(1, 'rgba(239, 247, 252, 0)')
      ctx.fillStyle = bloom2
      ctx.fillRect(0, 0, width, height)

      const parallax = (pointerX - 0.5) * 10
      drawWave(height * 0.5 + parallax * 0.2, 22, 0.0072, 0.95, 'rgba(244, 251, 252, 0.14)', 0)
      drawWave(height * 0.6 + parallax * 0.35, 28, 0.009, 1.2, 'rgba(47, 196, 255, 0.26)', 1.4)
      drawWave(height * 0.7 + parallax * 0.5, 20, 0.011, 0.9, 'rgba(10, 127, 168, 0.28)', 2.6)
      drawWave(height * 0.8 + parallax * 0.65, 15, 0.013, 1.1, 'rgba(0, 34, 49, 0.32)', 0.7)

      for (let i = 0; i < 5; i++) {
        const y0 = height * (0.22 + i * 0.07)
        ctx.beginPath()
        ctx.strokeStyle = `rgba(94, 200, 222, ${0.1 + i * 0.018})`
        ctx.lineWidth = 1
        for (let x = 0; x <= width; x += 5) {
          const y =
            y0 +
            Math.sin(x * 0.0055 + t * 0.45 + i) * 10 +
            Math.cos(x * 0.011 - t * 0.28 + i * 0.8) * 5 +
            (pointerY - 0.5) * 8
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      rippleTimer += 1
      if (rippleTimer % 90 === 0) spawnRipple()
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]
        ripple.r += 0.7
        ripple.alpha *= 0.985
        ctx.beginPath()
        ctx.strokeStyle = `rgba(47, 196, 255, ${ripple.alpha})`
        ctx.lineWidth = 1.4
        ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2)
        ctx.stroke()
        if (ripple.r > ripple.max || ripple.alpha < 0.02) ripples.splice(i, 1)
      }

      for (const p of particles) {
        p.y -= p.speed
        p.x += p.drift + Math.sin(t * 0.8 + p.y * 0.02) * 0.25
        p.twinkle += 0.04
        if (p.y < -8) {
          p.y = height + 8
          p.x = Math.random() * width
        }
        if (p.x < -8) p.x = width + 8
        if (p.x > width + 8) p.x = -8

        const a = p.alpha * (0.55 + Math.sin(p.twinkle) * 0.45)
        ctx.beginPath()
        ctx.fillStyle = `rgba(239, 247, 252, ${a})`
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }

      t += 0.016
      raf = requestAnimationFrame(drawFrame)
    }

    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(root)
    window.addEventListener('resize', resize)
    root.addEventListener('pointermove', onPointerMove)

    if (prefersReducedMotion()) {
      drawStatic()
    } else {
      raf = requestAnimationFrame(drawFrame)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      root.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  return (
    <div className="hero-abas" ref={rootRef}>
      <section
        className={`hero-abas__hero${ready ? ' is-ready' : ''}`}
        aria-label="Abastecimento de Água"
      >
        <canvas
          ref={canvasRef}
          id="hero-canvas-abas"
          className="hero-abas__canvas"
          aria-hidden="true"
        />
        <div className="hero-abas__scrim" aria-hidden="true" />
        <div className="hero-abas__sweep" aria-hidden="true" />
        <div className="hero-abas__flow" aria-hidden="true" />

        <div className="hero-abas__inner">
          <h1 className="hero-abas__title">Abastecimento de Água</h1>
          <span className="hero-abas__accent" aria-hidden="true" />
          <p className="hero-abas__subtitle">
            Captação, tratamento e distribuição
          </p>
        </div>
      </section>
    </div>
  )
}

export default HeroAbastecimento
