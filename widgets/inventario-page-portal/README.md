# SIHS — Tela Inicial (ArcGIS Enterprise + Web Map)

Aplicação web em **HTML, CSS e JavaScript puro (ES Modules)** que consome um **Web Map existente** do **ArcGIS Enterprise**, respeitando as camadas já configuradas no Portal, e alimenta **cards/indicadores** com consultas reais (`queryFeatures` / `outStatistics`).

Nenhum dado do inventário é duplicado em JSON local. O **ArcGIS Enterprise permanece a fonte da verdade**.

---

## Arquitetura

```text
index.html          → shell da interface
css/style.css       → layout e tema
js/config.js        → URL do Portal, ID do Web Map, OAuth, cards
js/app.js           → orquestração / inicialização
js/map.js           → autenticação, WebMap, MapView, clique
js/layers.js        → descoberta e metadados das camadas
js/statistics.js    → consultas e estatísticas
js/cards.js         → DOM dos indicadores e painel lateral
```

### Como o Web Map é consumido

1. `esriConfig.portalUrl` aponta para o Portal Enterprise.
2. `IdentityManager` (e opcionalmente `OAuthInfo`) trata autenticação quando o recurso é protegido.
3. `WebMap` é criado com `portalItem: { id }` — **sem recriar FeatureLayers no código**.
4. `MapView` renderiza o Web Map com legenda e controles.
5. `webMap.allLayers` enumera camadas (incluindo grupos).
6. `queryFeatures` / `outStatistics` consultam os serviços publicados no Enterprise.
7. Os resultados atualizam os cards no DOM.

### APIs / classes do ArcGIS Maps SDK utilizadas

| Classe / API | Uso |
|---|---|
| `@arcgis/core/config` (`esriConfig`) | `portalUrl` do Enterprise |
| `IdentityManager` | Credenciais / login |
| `OAuthInfo` | OAuth 2.0 (opcional) |
| `WebMap` | Carregar o Web Map do Portal |
| `MapView` | Visualização 2D |
| `Legend`, `Zoom`, `Home`, `Expand`, `BasemapToggle` | Controles da UI |
| `layer.queryFeatures` / `createQuery` / `outStatistics` | Indicadores |
| `view.hitTest` | Seleção de feição |

---

## Configuração obrigatória

Edite **`js/config.js`**:

### 1) URL do Portal Enterprise

```js
export const PORTAL_URL = "https://seu-portal.dominio.com/portal";
```

### 2) ID do Web Map

```js
export const WEB_MAP_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
```

O ID é o item do Web Map no Portal (URL do item ou página de detalhes).

### 3) OAuth App ID (recomendado em Portal privado)

1. No Portal, registre uma aplicação (OAuth 2.0).
2. Adicione redirect URI apontando para a URL da sua app (ex.: `http://localhost:5500/` ou `https://servidor/sihs/`).
3. Cole o Client ID:

```js
export const OAUTH_APP_ID = "seuClientId";
```

> Não coloque usuário ou senha no código. Se o OAuth não estiver configurado, o `IdentityManager` ainda pode abrir o diálogo de token quando necessário. Use também o botão **Entrar no Portal**.

### 4) Cards (opcional)

Se `CARD_DEFINITIONS` estiver vazio, a app gera cards automaticamente (contagem) a partir das `FeatureLayer` do Web Map.

Para indicadores customizados:

```js
export const CARD_DEFINITIONS = [
  {
    id: "exemplo",
    label: "Meu indicador",
    layerTitle: "Titulo Exato Da Camada No Web Map",
    statisticType: "count",
    onStatisticField: "OBJECTID",
    where: "1=1"
  }
];
```

---

## Como iniciar localmente

Não abra `index.html` via `file://` (CORS / módulos falham). Sirva por HTTP:

### Opção A — Python

```bash
cd "caminho/para/SIHS-TELA INICIAL"
python -m http.server 5500
```

Abra: `http://localhost:5500`

### Opção B — Node (npx)

```bash
npx --yes serve -l 5500
```

### Opção C — VS Code / Cursor Live Server

Use a extensão Live Server na pasta do projeto.

---

## Como testar

1. Preencha `PORTAL_URL` e `WEB_MAP_ID` em `js/config.js`.
2. Sirva a pasta por HTTP e abra o navegador.
3. Se o Portal pedir login, autentique (botão **Entrar no Portal** ou diálogo do SDK).
4. Confirme:
   - mapa carrega com as camadas do Web Map;
   - painel lateral lista as camadas;
   - cards mostram números (não “—” permanente);
   - clique em uma feição → atributos no painel e no **Console** (F12).

### Verificar se as camadas estão carregando

Abra o DevTools → **Console**. Procure o grupo:

```text
[layers] Camadas do Web Map (N)
```

Cada camada deve exibir `title`, `type`, `url`, `fieldCount` e `fields`.

No painel direito, a lista **Camadas do Web Map** também deve popular.

---

## Problemas comuns

### Autenticação

| Sintoma | O que verificar |
|---|---|
| 401 / 403 / “Unauthorized” | Login no Portal; permissões do Web Map/serviços |
| Diálogo de login não aparece | Clique em **Entrar no Portal**; configure `OAUTH_APP_ID` |
| OAuth redirect inválido | Redirect URI no item da Application deve bater com a URL da app |

### CORS

| Sintoma | O que verificar |
|---|---|
| `Failed to fetch` / CORS no Network | Portal/Server precisa permitir a origem da app |
| App em `file://` | Use servidor HTTP local ou IIS |
| Domínio diferente do Portal | Configure CORS no ArcGIS Server / reverse proxy, ou hospede a app no mesmo domínio |

No Enterprise, opções típicas:

- publicar a app no mesmo host do Portal/Web Adaptor;
- configurar CORS nos serviços / proxy reverso (IIS ARR, nginx, etc.).

### Placeholders

Se a overlay disser que `WEB_MAP_ID` ou `PORTAL_URL` não estão configurados, ainda há valores `COLOCAR_...` em `js/config.js`.

---

## Publicar no IIS (Windows)

1. Copie a pasta do projeto para o servidor, por exemplo:

   `C:\inetpub\wwwroot\sihs-tela-inicial`

2. No **IIS Manager**:
   - crie um **Application** ou use o site padrão;
   - aponte para a pasta acima;
   - garanta que `index.html` é documento padrão.

3. MIME types (geralmente já existem):
   - `.js` → `application/javascript` ou `text/javascript`
   - `.css` → `text/css`
   - `.json` → `application/json` (se usar no futuro)

4. Acesse: `https://seu-servidor/sihs-tela-inicial/`

5. No Portal, atualize o **Redirect URI** do OAuth para essa URL.

6. Teste login, mapa, cards e clique em feição.

### Dica de rede

Se possível, hospede a aplicação no **mesmo domínio** do Portal/Web Adaptor para reduzir atrito de CORS e cookies de sessão.

---

## Extensões futuras (já preparadas)

- Filtros (`where`) reutilizando `queryWithFilter` / `queryStatistics`
- Estatísticas só na extensão do mapa (`queryVisibleInExtent`, `countVisibleInExtent`)
- Gráficos consumindo os mesmos resultados de `statistics.js`
- Clique na feição → atualizar cards (callback em `enableFeatureSelection` em `map.js`)

---

## Estrutura de arquivos

```text
SIHS-TELA INICIAL/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── config.js
│   ├── app.js
│   ├── map.js
│   ├── layers.js
│   ├── statistics.js
│   └── cards.js
└── README.md
```
