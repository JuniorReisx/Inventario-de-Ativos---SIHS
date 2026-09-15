import { React, UrlManager, getAppStore } from 'jimu-core'
import { PORTAL_MODULOS, type ModuleItem } from './modulos'
import './style.css'

const SOURCES = [
  { name: 'População estimada', source: 'IBGE', year: '2026' },
  { name: 'Abastecimento de água', source: 'IBGE SIDRA 6803', year: '2022' },
  { name: 'Esgotamento sanitário', source: 'IBGE SIDRA 6805', year: '2022' },
  { name: 'Urbano e rural', source: 'Censo IBGE · setores censitários', year: '2022' },
  { name: 'Território e Semiárido', source: 'IBGE · DPA', year: '2026' },
  { name: 'Infraestrutura básica', source: 'Site da ANA e CERB', year: '2026' },
  { name: 'Atendimento Embasa', source: 'Site da Embasa', year: '2026' }
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

const ConteudoSobre = ({ folderUrl }: { folderUrl: string }) => {
  const goTo = (item: ModuleItem) => {
    const id = findPageIdByLabel(item.pageLabel, item.matchStartsWith) || item.pageId
    UrlManager.getInstance().changePage(id)
  }
  const base = folderUrl.endsWith('/') ? folderUrl : `${folderUrl}/`
  const asset = (file: string) => `${base}dist/runtime/assets/${file}`
  const partners = [
    {
      file: 'embasa.jpg',
      name: 'EMBASA',
      text: 'Empresa Baiana de Águas e Saneamento'
    },
    {
      file: 'cerb.png',
      name: 'CERB',
      text: 'Companhia de Engenharia Hídrica e de Saneamento da Bahia'
    },
    {
      file: 'agersa.png',
      name: 'AGERSA',
      text: 'Agência Reguladora de Saneamento Básico do Estado da Bahia'
    }
  ]

  return (
    <div className="sobre-body">
      <section className="sobre-intro" id="sobre-portal">
        <p className="sobre-kicker">Aplicação · Portal da Água</p>
        <h2>Inventário de Infraestrutura Hídrica e Saneamento</h2>
        <p className="sobre-lead">
          Esta aplicação faz parte do Portal da Água, da Secretaria de Infraestrutura
          Hídrica e Saneamento (SIHS).           Ela coloca no mesmo recorte territorial o inventário de
          reservatórios, sistemas de abastecimento e poços e os indicadores de
          como a população da Bahia se abastece e esgota.
        </p>
      </section>

      <section className="sobre-block" id="sobre-modulos">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Navegação</p>
          <h2>O que cada módulo mostra</h2>
          <p>
            O header leva a cinco telas. Infraestrutura mostra reservatórios, sistemas e poços; água e esgoto
            falam de domicílios; o Atlas fala de mapas.
          </p>
        </header>
        <div className="sobre-modules">
          {PORTAL_MODULOS.map((item) => (
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
          <p className="sobre-kicker">Fontes</p>
          <h2>De onde vêm os dados</h2>
        </header>
        <div className="sobre-table-wrap">
          <table className="sobre-table">
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Fonte</th>
                <th>Ano</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((item) => (
                <tr key={item.name}>
                  <th scope="row">{item.name}</th>
                  <td>{item.source}</td>
                  <td><span className="sobre-year">{item.year}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sobre-block" id="sobre-parceiras">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Parceiras</p>
          <h2>Empresas parceiras</h2>
        </header>
        <ul className="sobre-partners">
          {partners.map((item) => (
            <li key={item.name}>
              <img src={asset(item.file)} alt={item.name} />
              <strong>{item.name}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="sobre-block sobre-block--last" id="sobre-dev">
        <header className="sobre-block__head">
          <p className="sobre-kicker">Construção</p>
          <h2>Como a aplicação foi desenvolvida</h2>
          <p>
            A aplicação é um Experience no <b>ArcGIS Experience Builder Developer 1.17</b>.
            Os widgets foram <b>totalmente personalizados</b>: não há nada nativo do Builder
            nas telas — Início, Infraestrutura, Abastecimento, Esgotamento, Atlas, Sobre,
            header e rodapé foram feitos sob medida.
          </p>
        </header>
        <ul className="sobre-dev">
          <li>
            <h3>Widgets próprios</h3>
            <p>
              Nenhuma tela usa widget nativo do Experience Builder. Tudo foi
              desenvolvido em React para esta aplicação.
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
