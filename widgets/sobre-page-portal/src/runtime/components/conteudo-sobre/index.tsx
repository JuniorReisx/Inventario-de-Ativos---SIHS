import { React, UrlManager, getAppStore } from 'jimu-core'
import './style.css'

type JumpItem = {
  href: string
  label: string
}

type ModuleItem = {
  index: string
  title: string
  text: string
  pageLabel: string
  pageId: string
  matchStartsWith?: boolean
}

const JUMP: JumpItem[] = [
  { href: '#sobre-portal', label: 'O portal' },
  { href: '#sobre-uso', label: 'Como usar' },
  { href: '#sobre-modulos', label: 'Módulos' },
  { href: '#sobre-leituras', label: 'Duas leituras' },
  { href: '#sobre-fontes', label: 'Fontes' },
  { href: '#sobre-dev', label: 'Como foi feito' }
]

const MODULES: ModuleItem[] = [
  {
    index: '01',
    title: 'Início',
    text: 'Apresenta o Portal e leva às demais telas. Use os cartões para abrir infraestrutura, abastecimento, esgotamento ou o Atlas.',
    pageLabel: 'Ínicio',
    pageId: 'page_45'
  },
  {
    index: '02',
    title: 'Infraestrutura hídrica',
    text: 'Inventário de ativos no mapa: reservatórios, sistemas de abastecimento e poços. Filtre por território, semiárido ou município e leia os gráficos do recorte.',
    pageLabel: 'Infraestrutura Hídrica',
    pageId: 'page_41'
  },
  {
    index: '03',
    title: 'Abastecimento de água',
    text: 'Indicadores municipais de forma de abastecimento (SIDRA 6803). KPIs, composição, mapa e a divisão urbano/rural pelos setores censitários.',
    pageLabel: 'Abastecimento de Água',
    pageId: 'page_39'
  },
  {
    index: '04',
    title: 'Esgotamento sanitário',
    text: 'Indicadores municipais de tipo de esgoto (SIDRA 6805). Mesma lógica da água: totais oficiais no município e composição urbano/rural nos setores.',
    pageLabel: 'Esgotamento Sanitário',
    pageId: 'page_40'
  },
  {
    index: '05',
    title: 'Atlas',
    text: 'Mapas territoriais para consulta espacial da infraestrutura hídrica e do saneamento no Estado.',
    pageLabel: 'Atlas',
    pageId: 'page_52',
    matchStartsWith: true
  }
]

const STEPS = [
  {
    n: '1',
    title: 'Escolha o tema',
    text: 'No header, abra Infraestrutura, Abastecimento, Esgotamento ou Atlas. Cada tela usa o mesmo recorte territorial, com dados próprios.'
  },
  {
    n: '2',
    title: 'Recorte o território',
    text: 'Agrupe por Território de Identidade ou Semiárido, ou busque um município. O mapa e os números acompanham essa seleção.'
  },
  {
    n: '3',
    title: 'Leia mapa, KPIs e gráficos',
    text: 'O mapa mostra o recorte. Os cartões e gráficos resumem população, atendimento e a composição das formas de água ou esgoto.'
  },
  {
    n: '4',
    title: 'Exporte o relatório',
    text: 'Em água, esgoto e infraestrutura, o PDF registra a seleção atual: indicadores, tabelas, mapa e as fontes de cada número.'
  }
]

const SOURCES: Array<[string, string]> = [
  ['População residente', 'Estimativa IBGE 2026 (último campo de população estimada) nas camadas DPA_Indicadores_Censo_2022, Limite Bahia e Região Semiárida.'],
  ['Formas de abastecimento de água (rede, poço profundo, poço raso, fonte, pipa, chuva, rio, outra)', 'SIDRA tabela 6803 · Censo IBGE 2022 · DPA Indicadores (campos aa_*). Totais oficiais por município.'],
  ['Sem ligação à rede geral de água', 'SIDRA tabela 6803 · DPA Indicadores (aa_npl_rg).'],
  ['Atendimento adequado de água', 'Calculado no painel: rede geral + poço profundo/artesiano + poço raso/freático/cacimba (SIDRA 6803).'],
  ['Formas de esgotamento (rede, fossa séptica, fossa rudimentar, vala, rio, outra)', 'SIDRA tabela 6805 · Censo IBGE 2022 · DPA Indicadores (campos esg_*). Totais oficiais por município.'],
  ['Sem banheiro nem sanitário', 'SIDRA tabela 6805 · DPA Indicadores (esg_n_t_bs).'],
  ['Atendimento adequado de esgoto', 'Calculado no painel: rede/fossa ligada à rede + fossa séptica/filtro (SIDRA 6805).'],
  ['Domicílios urbanos e rurais', 'Censo IBGE 2022 · camada Setores Censitarios_BA (Situação do setor + v0002). Não aparece no mapa.'],
  ['Formas de água no urbano e no rural', 'Setores censitários (v00111 a v00117). Não fecha com o total municipal da tabela 6803.'],
  ['Formas de esgoto no urbano e no rural', 'Setores censitários (v00309 rede, v00232 banheiro). Não fecha com o total municipal da tabela 6805.'],
  ['Território de Identidade e Semiárido', 'Atributos municipais da camada DPA Indicadores, usados só para filtrar o recorte.'],
  ['Inventário de ativos (reservatórios, sistemas, poços)', 'Web map de infraestrutura hídrica do Portal da Água / SIHS.'],
  ['Atendimento Embasa', 'Campos de abastecimento e esgotamento sanitário na camada municipal DPA.']
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

const ConteudoSobre = () => {
  const goTo = (item: ModuleItem) => {
    const id = findPageIdByLabel(item.pageLabel, item.matchStartsWith) || item.pageId
    UrlManager.getInstance().changePage(id)
  }

  return (
    <div className="sobre-body">
      <nav className="sobre-jump" aria-label="Seções desta página">
        {JUMP.map((item) => (
          <a key={item.href} href={item.href}>{item.label}</a>
        ))}
      </nav>

      <section className="sobre-intro" id="sobre-portal">
        <p className="sobre-kicker">Portal da Água · SIHS/BA</p>
        <h2>Um painel para ver água e saneamento no território</h2>
        <p className="sobre-lead">
          O Portal da Água reúne o inventário de infraestrutura hídrica e saneamento e os indicadores do
          Censo IBGE 2022 para apoiar a gestão, o planejamento e a decisão na Bahia.
          Ele foi pensado para responder, no mesmo recorte de mapa:{' '}
          <b>onde está a infraestrutura</b>, <b>como a população se abastece</b> e{' '}
          <b>como esgota</b>.
        </p>
        <div className="sobre-pills">
          <span>417 municípios</span>
          <span>Censo IBGE 2022</span>
          <span>SIDRA 6803 e 6805</span>
          <span>Setores censitários</span>
        </div>
      </section>

      <section className="sobre-block" id="sobre-uso">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Uso</p>
          <h2>Como a aplicação funciona</h2>
          <p>
            Todas as telas seguem o mesmo gesto: escolher o tema, recortar o território
            e ler o que o mapa e os números dizem daquela seleção.
          </p>
        </header>
        <ol className="sobre-steps">
          {STEPS.map((step) => (
            <li key={step.n}>
              <span className="sobre-steps__n">{step.n}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="sobre-block" id="sobre-modulos">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Navegação</p>
          <h2>O que cada módulo mostra</h2>
          <p>
            O header leva a cinco telas. Infraestrutura fala de ativos; água e esgoto
            falam de domicílios; o Atlas fala de mapas.
          </p>
        </header>
        <div className="sobre-modules">
          {MODULES.map((item) => (
            <button
              key={item.index}
              type="button"
              className="sobre-module"
              onClick={() => goTo(item)}
            >
              <span className="sobre-module__idx">{item.index}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <span className="sobre-module__go">Abrir tela</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sobre-block" id="sobre-leituras">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Leitura dos números</p>
          <h2>Duas tabelas do mesmo Censo</h2>
          <p>
            Em abastecimento e esgotamento, o total de cada forma (rede, poço, fossa…)
            <b> não deve ser somado</b> com o urbano/rural para conferir. São tabelas
            diferentes do IBGE, as duas de 2022.
          </p>
        </header>
        <div className="sobre-reads">
          <article className="sobre-read">
            <span className="sobre-read__tag">Leitura 1 · oficial</span>
            <h3>Município · DPA Indicadores</h3>
            <p>
              Camada <b>DPA_Indicadores_Censo_2022</b>. Compila o SIDRA por município:
              tabela <b>6803</b> (água) e <b>6805</b> (esgoto). Use estes números como
              o total oficial de cada forma no recorte.
            </p>
            <p className="sobre-read__note">
              100% = todos os domicílios do município (ou da seleção de municípios).
            </p>
          </article>
          <article className="sobre-read sobre-read--alt">
            <span className="sobre-read__tag">Leitura 2 · situação</span>
            <h3>Urbano e rural · setores</h3>
            <p>
              Camada <b>Setores Censitarios_BA</b>, campo Situação do setor. Serve para
              ver <b>onde</b> estão os domicílios e <b>como cada área</b> se abastece
              ou esgota. Os setores não aparecem no mapa.
            </p>
            <p className="sobre-read__note">
              100% = só a área urbana ou só a área rural — não o município.
            </p>
          </article>
        </div>
      </section>

      <section className="sobre-block" id="sobre-fontes">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Proveniência</p>
          <h2>Fonte de cada indicador</h2>
          <p>
            A DPA Indicadores não inventa dado: ela organiza o SIDRA e o Censo 2022
            no município. O urbano/rural vem da malha de setores censitários do IBGE.
          </p>
        </header>
        <div className="sobre-table-wrap">
          <table className="sobre-table">
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Fonte</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map(([name, source]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sobre-block sobre-block--last" id="sobre-dev">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Construção</p>
          <h2>Como o portal foi desenvolvido</h2>
          <p>
            A aplicação é um Experience no ArcGIS Experience Builder 1.17, com widgets
            próprios da SIHS. O mapa e as camadas vêm do Portal da Água; a leitura e
            os relatórios são feitos no navegador.
          </p>
        </header>
        <ul className="sobre-dev">
          <li>
            <h3>ArcGIS Experience Builder</h3>
            <p>
              Cada tela é um widget React (Início, Infraestrutura, Abastecimento,
              Esgotamento, Atlas, Sobre), com o mesmo header e rodapé. O recorte
              ativo dispara consulta nas camadas do web map.
            </p>
          </li>
          <li>
            <h3>Web maps e Feature Services</h3>
            <p>
              O mapa ao vivo é o web map do inventário. A camada municipal
              DPA_Indicadores_Censo_2022 alimenta KPIs e formas oficiais. A camada
              Setores Censitarios_BA é consultada só para os gráficos urbano/rural
              e permanece oculta no mapa.
            </p>
          </li>
          <li>
            <h3>Filtros territoriais</h3>
            <p>
              Território de Identidade, Semiárido e município vêm de atributos da
              DPA. A seleção no mapa e a busca por nome usam o mesmo código IBGE,
              para mapa, tabela e PDF falarem do mesmo recorte.
            </p>
          </li>
          <li>
            <h3>Relatório em PDF</h3>
            <p>
              O PDF é gerado no cliente: captura o mapa da seleção, os indicadores
              e as tabelas, e fecha com as fontes. Não altera o dado — só registra
              o que a tela já mostra.
            </p>
          </li>
        </ul>
      </section>
    </div>
  )
}

export default ConteudoSobre
