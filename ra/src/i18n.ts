// src/i18n.ts — RA language selector: natural-keyed catalogs with en fallback.
// Locale priority: ~/.ra/locale.json lock > LC_ALL/LANG env > Intl detection.
// The first TUI run auto-locks the detected locale; `ra lang [code]` and the
// /lang command re-lock later. Unknown/unsupported locales resolve to en.
//
// ponytail: natural-key catalogs — the English string IS the key, so en needs
// no table and keys can never drift from the shipped English text. Ceiling:
// rewording an English string orphans the old translations until the
// completeness sweep (ra/tests/i18n.test.ts) flags them; number/date/currency
// localization and plural rules stay out of scope — format at call sites.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Locale = "en" | "pt-BR" | "ja" | "de" | "pl";

export const SUPPORTED: Array<{ code: Locale; name: string }> = [
  { code: "en", name: "English" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "ja", name: "日本語" },
  { code: "de", name: "Deutsch" },
  { code: "pl", name: "Polski" },
];

/** English names for the agent output directive — models parse these reliably. */
const DIRECTIVE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  ja: "Japanese",
  de: "German",
  pl: "Polish",
};

/**
 * Translation tables, keyed by the exact English string. `en` is the identity
 * fallback (the key itself), so it has no table. Append-only; the test sweep
 * requires every key to exist in every non-en locale.
 */
export const CATALOGS: Record<Exclude<Locale, "en">, Record<string, string>> = {
  "pt-BR": {
    // chrome
    "working": "trabalhando",
    "working…": "trabalhando…",
    "/ search · ? shortcuts": "/ buscar · ? atalhos",
    "no model — run ra setup": "nenhum modelo — execute ra setup",
    "search": "buscar",
    "palette": "paleta",
    "explorer": "explorador",
    "keys": "atalhos",
    "cancel": "cancelar",
    "close": "fechar",
    "quit": "sair",
    "busy": "ocupado",
    // explorer tabs + panes
    "file": "arquivo",
    "agents": "agentes",
    "sessions": "sessões",
    "web": "web",
    "msg": "msg",
    "click a file on the left to preview it": "clique num arquivo à esquerda para pré-visualizá-lo",
    "symbol outline {0} {1} agents {2} sessions {2} /web search in the tabs above": "estrutura de símbolos {0} {1} agentes {2} sessões {2} busca /web nas abas acima",
    "{0} lines {1} {2} symbols": "{0} linhas {1} {2} símbolos",
    "(no description)": "(sem descrição)",
    "delegate: agent:{0} <task> in the prompt": "delegue: agent:{0} <tarefa> no prompt",
    "esc/back: back to the catalog": "esc/voltar: voltar ao catálogo",
    "agent catalog — click one for its card": "catálogo de agentes — clique num para ver o cartão",
    "agent catalog - click one for its card": "catálogo de agentes - clique num para ver o cartão",
    "sessions — click to switch (restart ra to reopen)": "sessões — clique para trocar (reinicie o ra para reabrir)",
    "sessions - click to switch (restart ra to reopen)": "sessões - clique para trocar (reinicie o ra para reabrir)",
    "  (no saved sessions)": "  (nenhuma sessão salva)",
    "web: {0}": "web: {0}",
    "type /web <query> in the prompt to search": "digite /web <consulta> no prompt para buscar",
    "fetching…": "buscando…",
    "fetching...": "buscando...",
    "── content ──": "── conteúdo ──",
    "-- content --": "-- conteúdo --",
    "── fetched page (text) · click another result to switch ──": "── página baixada (texto) · clique noutro resultado para trocar ──",
    "-- fetched page (text) - click another result to switch --": "-- página baixada (texto) - clique noutro resultado para trocar --",
    "  (no results)": "  (nenhum resultado)",
    "  q close · tab switch": "  q fecha · tab troca de aba",
    "  q close - tab switch": "  q fecha - tab troca de aba",
    // splash
    "v{0}  ·  press any key to begin": "v{0}  ·  pressione qualquer tecla para começar",
    "no model yet — run ra setup after this screen": "nenhum modelo ainda — execute ra setup após esta tela",
    // tree
    "╭ subagents ──────────────": "╭ subagentes ────────────",
    // shortcuts overlay
    "search everything — commands, agents, files, models, themes": "busque tudo — comandos, agentes, arquivos, modelos, temas",
    "open the palette": "abrir a paleta",
    "explorer — walk the workspace, agents, sessions, web with the mouse": "explorador — navegue por arquivos, agentes, sessões e web com o mouse",
    "this shortcuts panel": "este painel de atalhos",
    "complete the highlighted palette entry": "completar o item destacado da paleta",
    "close overlay · cancel the running task": "fechar o painel · cancelar a tarefa em execução",
    "cancel task / clear input": "cancelar tarefa / limpar a entrada",
    "quit RA": "sair do RA",
    "clear the screen": "limpar a tela",
    "clear the input line": "limpar a linha de entrada",
    "scroll history or palette · ↑ in the input recalls previous prompts": "rolar histórico ou paleta · ↑ na entrada recupera prompts anteriores",
    "context menu at the mouse": "menu de contexto no mouse",
    "logo = main menu · model chips = model menu": "logo = menu principal · chips de modelo = menu de modelos",
    "scroll the conversation": "rolar a conversa",
    "delegate directly to one agent": "delegar diretamente a um agente",
    "attach a project file to the prompt": "anexar um arquivo do projeto ao prompt",
    "run a shell command (standard tools apply)": "executar um comando do shell (ferramentas padrão se aplicam)",
    "  ?  RA shortcuts — click or press any key to close  ": "  ?  Atalhos do RA — clique ou pressione qualquer tecla para fechar  ",
    "  theme: {0} — change with /theme or the theme menu": "  tema: {0} — troque com /theme ou o menu de temas",
    "  press any key to close  ": "  pressione qualquer tecla para fechar  ",
    // onboarding
    "  Welcome to RA ({0})": "  Bem-vindo ao RA ({0})",
    "  the swiss-army terminal agent — for first-timers and pros": "  o agente de terminal canivete suíço — para iniciantes e profissionais",
    "  Step 2/3 — pick a look (↑↓ + enter, or click):": "  Passo 2/3 — escolha uma aparência (↑↓ + enter, ou clique):",
    "  enter confirms · you can change it any time with /theme": "  enter confirma · você pode trocar a qualquer momento com /theme",
    "  Step 3/3 — what do you want to do first? (click or ↑↓ + enter)": "  Passo 3/3 — o que você quer fazer primeiro? (clique ou ↑↓ + enter)",
    "Build something": "Construir algo",
    "describe an app — RA plans, codes and verifies it": "descreva um app — o RA planeja, programa e verifica",
    "Get opinions": "Ouvir opiniões",
    "several agents review a problem and synthesize": "vários agentes revisam um problema e sintetizam",
    "Just chat": "Só conversar",
    "type anything — RA answers and can use tools": "digite qualquer coisa — o RA responde e pode usar ferramentas",
    "  ? shows every shortcut · / searches everything": "  ? mostra todos os atalhos · / busca tudo",
    // setup overlay
    "  Step 1/3 — find your models": "  Passo 1/3 — encontre seus modelos",
    "  scanning…": "  procurando…",
    "  Scan my local network for AI servers?": "  Procurar servidores de IA na minha rede local?",
    "Yes — scan this /24 for Ollama / LM Studio / llama.cpp": "Sim — varrer esta /24 por Ollama / LM Studio / llama.cpp",
    "   No — localhost only": "   Não — apenas localhost",
    "  No local server found. Use a cloud provider?": "  Nenhum servidor local encontrado. Usar um provedor de nuvem?",
    "Skip for now — local-only / later (ra setup)": "Pular por agora — só local / depois (ra setup)",
    "  Pick your lanes — small detects, big fixes:": "  Escolha suas pistas — small detecta, big corrige:",
    "small  {0}": "small  {0}",
    "small  (none found)": "small  (nenhum encontrado)",
    "big    {0}": "big    {0}",
    "big    unset (local-only)": "big    não definido (só local)",
    "Finish — test + save": "Concluir — testar + salvar",
    "  s skip · esc skip setup · ↑↓ + enter selects": "  s pula · esc pula a configuração · ↑↓ + enter seleciona",
    // app: statuses + palette + welcome
    "orchestrating…": "orquestrando…",
    "responding…": "respondendo…",
    "cancelling…": "cancelando…",
    "finishing…": "finalizando…",
    "{0} working…": "{0} trabalhando…",
    "no model ": "nenhum modelo ",
    "  no matches — keep typing": "  nada encontrado — continue digitando",
    "  ↑↓ select · enter run · tab insert · esc close · mouse clickable ({0})": "  ↑↓ seleciona · enter executa · tab insere · esc fecha · clicável com o mouse ({0})",
    " search everything — commands · agents · files · models · sessions · themes ": " buscar tudo — comandos · agentes · arquivos · modelos · sessões · temas ",
    "open this palette": "abrir esta paleta",
    "plan + implement a task": "planejar + implementar uma tarefa",
    "multiple agents, one synthesis": "vários agentes, uma síntese",
    "custom command · agent: {0}": "comando personalizado · agente: {0}",
    "delegate a task": "delegar uma tarefa",
    "{0} · accent {1}": "{0} · destaque {1}",
    "find local AI servers and pick small/big": "encontrar servidores de IA locais e escolher small/big",
    "forget the saved choice and scan again": "descartar a escolha salva e procurar de novo",
    "pick a different detector model": "escolher outro modelo detector",
    "pick a different fixer model": "escolher outro modelo corrigidor",
    "use as implementation model": "usar como modelo de implementação",
    "use as planning model": "usar como modelo de planejamento",
    "explorer — walk the workspace with the mouse": "explorador — navegue pelo projeto com o mouse",
    "web search in the explorer (Brave/Tavily key)": "busca na web no explorador (chave Brave/Tavily)",
    "insert @file reference": "inserir referência @arquivo",
    "show or switch the UI/agent language": "mostrar ou trocar o idioma da interface/agente",
    "Welcome to {0}.": "Bem-vindo ao {0}.",
    "  /                search EVERYTHING — commands · agents · files · models · themes": "  /                busque TUDO — comandos · agentes · arquivos · modelos · temas",
    "  ctrl+e / /files  explorer — walk files · agents · sessions · web with the mouse": "  ctrl+e / /files  explorador — navegue por arquivos · agentes · sessões · web com o mouse",
    "  /quick <task>    plan + implement": "  /quick <tarefa>  planejar + implementar",
    "  /moa <task>      multiple agents, one synthesis": "  /moa <tarefa>    vários agentes, uma síntese",
    "  agent:<name> …   delegate to one agent directly": "  agent:<nome> …   delegar diretamente a um agente",
    "  ?                all shortcuts": "  ?                todos os atalhos",
    "small: {0} · code: {1}": "small: {0} · código: {1}",
    "\\n/history to review · /clear to reset": "\\n/history para revisar · /clear para limpar",
    // app: actions + menus
    "theme → {0} (saved)": "tema → {0} (salvo)",
    "{0} model → {1} (this session)": "modelo {0} → {1} (nesta sessão)",
    "session pointer → {0}. Restart ra to open it.": "ponteiro de sessão → {0}. Reinicie o ra para abri-la.",
    "session switch failed: {0}": "falha ao trocar de sessão: {0}",
    "Search everything": "Buscar tudo",
    "commands · files · agents · models · themes": "comandos · arquivos · agentes · modelos · temas",
    "Explorer": "Explorador",
    "files · agents · sessions · web": "arquivos · agentes · sessões · web",
    "Themes": "Temas",
    "{0} looks, live preview": "{0} aparências, pré-visualização ao vivo",
    "Models": "Modelos",
    "Agents": "Agentes",
    "Shortcuts": "Atalhos",
    "Clear screen": "Limpar a tela",
    "Cancel task": "Cancelar tarefa",
    "Quit RA": "Sair do RA",
    "cancelled — prompt discarded": "cancelado — prompt descartado",
    "mixture skipped — answering normally": "mistura ignorada — respondendo normalmente",
    "unknown command {0} — press / to search": "comando desconhecido {0} — pressione / para buscar",
    "You're set. Press / any time to search everything.": "Tudo pronto. Pressione / a qualquer momento para buscar tudo.",
    "TIP: {0}": "DICA: {0}",
    "search failed: {0}": "falha na busca: {0}",
    "\\r\\nsplash error: {0}\\r\\n": "\\r\\nerro na splash: {0}\\r\\n",
    "Introduce yourself as the {0} agent in one short paragraph.": "Apresente-se como o agente {0} em um parágrafo curto.",
    // mixture menu
    "Run as mixture?": "Executar como mistura?",
    "Fan out across {0} models": "Distribuir entre {0} modelos",
    "{0} — critics {1} · est {2}": "{0} — críticos {1} · est {2}",
    "subscription/free": "assinatura/grátis",
    "Just answer normally": "Responder normalmente",
    "single-lane orchestrator": "orquestrador de pista única",
    // setup wizard (app)
    "  {0} {1}:{2} {3}": "  {0} {1}:{2} {3}",
    "{0} · {1} models · {2}ms": "{0} · {1} modelos · {2}ms",
    "{0} · not running": "{0} · não está em execução",
    "  {0} scanning {1} … ({2} found so far)": "  {0} varrendo {1} … ({2} encontrados até agora)",
    "  No local network interface found — LAN scan skipped.": "  Nenhuma interface de rede local encontrada — varredura da LAN ignorada.",
    "no local server found — cloud config available via `ra setup` in a terminal": "nenhum servidor local encontrado — configuração de nuvem disponível via `ra setup` num terminal",
    "skipped — nothing saved": "pulada — nada salvo",
    "  {0} small host unreachable — pick another model or skip": "  {0} host do small inacessível — escolha outro modelo ou pule",
    "  {0} saved → {1}": "  {0} salvo → {1}",
    "  {0} setup error: {1}": "  {0} erro na configuração: {1}",
    "setup {0}": "configuração {0}",
    // context / telemetry / misc
    "context ──{0}\\n{1}\\n  TOTAL: {2} tok · ${3}": "contexto ──{0}\\n{1}\\n  TOTAL: {2} tok · ${3}",
    "↳ streamed above": "↳ exibido acima",
    "RA: task done": "RA: tarefa concluída",
    // /lang
    "language: {0}": "idioma: {0}",
    "supported: {0}": "suportados: {0}",
    "usage: /lang <code> — e.g. /lang pt-BR": "uso: /lang <código> — ex. /lang pt-BR",
    "language → {0} (locked — agent replies follow on the next turn)": "idioma → {0} (travado — respostas do agente seguem na próxima interação)",
    "unsupported language: {0} — supported: {1}": "idioma não suportado: {0} — suportados: {1}",
    // tips
    "press / to search EVERYTHING — commands, files, agents, models, themes": "pressione / para buscar TUDO — comandos, arquivos, agentes, modelos, temas",
    "right-click anywhere for the context menu": "clique com o botão direito em qualquer lugar para o menu de contexto",
    "? shows every shortcut": "? mostra todos os atalhos",
    "agent:ptah <task> delegates straight to the coder agent": "agent:ptah <tarefa> delega direto ao agente programador",
    "@src/app.ts attaches a file to your prompt": "@src/app.ts anexa um arquivo ao seu prompt",
    "/theme re-skins RA instantly — it stays after restart": "/theme troca a aparência do RA na hora — e persiste após reiniciar",
    "/moa asks several agents and synthesizes one answer": "/moa consulta vários agentes e sintetiza uma resposta",
  },
  ja: {
    // chrome
    "working": "処理中",
    "working…": "処理中…",
    "/ search · ? shortcuts": "/ 検索 · ? ショートカット",
    "no model — run ra setup": "モデルなし — ra setup を実行してください",
    "search": "検索",
    "palette": "パレット",
    "explorer": "エクスプローラー",
    "keys": "キー",
    "cancel": "キャンセル",
    "close": "閉じる",
    "quit": "終了",
    "busy": "稼働中",
    // explorer tabs + panes
    "file": "ファイル",
    "agents": "エージェント",
    "sessions": "セッション",
    "web": "web",
    "msg": "件",
    "click a file on the left to preview it": "左側のファイルをクリックするとプレビューできます",
    "symbol outline {0} {1} agents {2} sessions {2} /web search in the tabs above": "シンボルアウトライン {0} エージェント {1} {2} セッション {2} 上のタブで /web 検索",
    "{0} lines {1} {2} symbols": "{0} 行 {1} シンボル {2}",
    "(no description)": "(説明なし)",
    "delegate: agent:{0} <task> in the prompt": "委任: プロンプトに agent:{0} <タスク> と入力",
    "esc/back: back to the catalog": "esc/戻る: カタログに戻る",
    "agent catalog — click one for its card": "エージェントカタログ — クリックでカードを表示",
    "agent catalog - click one for its card": "エージェントカタログ - クリックでカードを表示",
    "sessions — click to switch (restart ra to reopen)": "セッション — クリックで切替 (再起動で開き直します)",
    "sessions - click to switch (restart ra to reopen)": "セッション - クリックで切替 (再起動で開き直します)",
    "  (no saved sessions)": "  (保存されたセッションなし)",
    "web: {0}": "web: {0}",
    "type /web <query> in the prompt to search": "検索するにはプロンプトに /web <クエリ> と入力",
    "fetching…": "取得中…",
    "fetching...": "取得中...",
    "── content ──": "── 内容 ──",
    "-- content --": "-- 内容 --",
    "── fetched page (text) · click another result to switch ──": "── 取得ページ (テキスト) · 別の結果をクリックで切替 ──",
    "-- fetched page (text) - click another result to switch --": "-- 取得ページ (テキスト) - 別の結果をクリックで切替 --",
    "  (no results)": "  (結果なし)",
    "  q close · tab switch": "  q 閉じる · tab タブ切替",
    "  q close - tab switch": "  q 閉じる - tab タブ切替",
    // splash
    "v{0}  ·  press any key to begin": "v{0}  ·  何かキーを押して開始",
    "no model yet — run ra setup after this screen": "モデル未設定 — この画面の後 ra setup を実行",
    // tree
    "╭ subagents ──────────────": "╭ サブエージェント ──────",
    // shortcuts overlay
    "search everything — commands, agents, files, models, themes": "すべて検索 — コマンド、エージェント、ファイル、モデル、テーマ",
    "open the palette": "パレットを開く",
    "explorer — walk the workspace, agents, sessions, web with the mouse": "エクスプローラー — マウスでワークスペース・エージェント・セッション・web を巡回",
    "this shortcuts panel": "このショートカットパネル",
    "complete the highlighted palette entry": "強調表示されたパレット項目を補完",
    "close overlay · cancel the running task": "オーバーレイを閉じる · 実行中のタスクをキャンセル",
    "cancel task / clear input": "タスクをキャンセル / 入力をクリア",
    "quit RA": "RA を終了",
    "clear the screen": "画面をクリア",
    "clear the input line": "入力行をクリア",
    "scroll history or palette · ↑ in the input recalls previous prompts": "履歴やパレットをスクロール · 入力行の ↑ で過去のプロンプトを呼び出し",
    "context menu at the mouse": "マウス位置にコンテキストメニュー",
    "logo = main menu · model chips = model menu": "ロゴ = メインメニュー · モデルチップ = モデルメニュー",
    "scroll the conversation": "会話をスクロール",
    "delegate directly to one agent": "特定のエージェントに直接委任",
    "attach a project file to the prompt": "プロジェクトファイルをプロンプトに添付",
    "run a shell command (standard tools apply)": "シェルコマンドを実行 (標準ツールが適用されます)",
    "  ?  RA shortcuts — click or press any key to close  ": "  ?  RA ショートカット — クリックまたは何かキーを押して閉じる  ",
    "  theme: {0} — change with /theme or the theme menu": "  テーマ: {0} — /theme またはテーマメニューで変更",
    "  press any key to close  ": "  何かキーを押して閉じる  ",
    // onboarding
    "  Welcome to RA ({0})": "  RA へようこそ ({0})",
    "  the swiss-army terminal agent — for first-timers and pros": "  スイスアーミーナイフのようなターミナルエージェント — 初心者からプロまで",
    "  Step 2/3 — pick a look (↑↓ + enter, or click):": "  ステップ 2/3 — 見た目を選択 (↑↓ + enter、またはクリック):",
    "  enter confirms · you can change it any time with /theme": "  enter で確定 · /theme でいつでも変更できます",
    "  Step 3/3 — what do you want to do first? (click or ↑↓ + enter)": "  ステップ 3/3 — 最初に何をしますか? (クリックまたは ↑↓ + enter)",
    "Build something": "何かを作る",
    "describe an app — RA plans, codes and verifies it": "アプリを説明すると RA が計画・実装・検証します",
    "Get opinions": "意見をもらう",
    "several agents review a problem and synthesize": "複数のエージェントが問題をレビューし統合します",
    "Just chat": "ただ雑談する",
    "type anything — RA answers and can use tools": "何でも入力 — RA が回答しツールも使えます",
    "  ? shows every shortcut · / searches everything": "  ? ですべてのショートカット · / ですべてを検索",
    // setup overlay
    "  Step 1/3 — find your models": "  ステップ 1/3 — モデルを見つける",
    "  scanning…": "  スキャン中…",
    "  Scan my local network for AI servers?": "  ローカルネットワークで AI サーバーをスキャンしますか?",
    "Yes — scan this /24 for Ollama / LM Studio / llama.cpp": "はい — この /24 を Ollama / LM Studio / llama.cpp についてスキャン",
    "   No — localhost only": "   いいえ — localhost のみ",
    "  No local server found. Use a cloud provider?": "  ローカルサーバーが見つかりません。クラウドプロバイダーを使いますか?",
    "Skip for now — local-only / later (ra setup)": "今はスキップ — ローカルのみ / 後で (ra setup)",
    "  Pick your lanes — small detects, big fixes:": "  レーンを選択 — small が検出、big が修正:",
    "small  {0}": "small  {0}",
    "small  (none found)": "small  (見つかりません)",
    "big    {0}": "big    {0}",
    "big    unset (local-only)": "big    未設定 (ローカルのみ)",
    "Finish — test + save": "完了 — テストして保存",
    "  s skip · esc skip setup · ↑↓ + enter selects": "  s スキップ · esc セットアップをスキップ · ↑↓ + enter で選択",
    // app: statuses + palette + welcome
    "orchestrating…": "オーケストレーション中…",
    "responding…": "応答中…",
    "cancelling…": "キャンセル中…",
    "finishing…": "完了待ち…",
    "{0} working…": "{0} 処理中…",
    "no model ": "モデルなし ",
    "  no matches — keep typing": "  一致なし — 入力を続けてください",
    "  ↑↓ select · enter run · tab insert · esc close · mouse clickable ({0})": "  ↑↓ 選択 · enter 実行 · tab 挿入 · esc 閉じる · マウスでクリック可 ({0})",
    " search everything — commands · agents · files · models · sessions · themes ": " すべて検索 — コマンド · エージェント · ファイル · モデル · セッション · テーマ ",
    "open this palette": "このパレットを開く",
    "plan + implement a task": "タスクを計画して実装",
    "multiple agents, one synthesis": "複数のエージェント、ひとつの統合回答",
    "custom command · agent: {0}": "カスタムコマンド · エージェント: {0}",
    "delegate a task": "タスクを委任",
    "{0} · accent {1}": "{0} · アクセント {1}",
    "find local AI servers and pick small/big": "ローカル AI サーバーを見つけて small/big を選択",
    "forget the saved choice and scan again": "保存した選択を破棄して再スキャン",
    "pick a different detector model": "別の検出用モデルを選択",
    "pick a different fixer model": "別の修正用モデルを選択",
    "use as implementation model": "実装用モデルとして使用",
    "use as planning model": "計画用モデルとして使用",
    "explorer — walk the workspace with the mouse": "エクスプローラー — マウスでワークスペースを巡回",
    "web search in the explorer (Brave/Tavily key)": "エクスプローラーで web 検索 (Brave/Tavily キー)",
    "insert @file reference": "@ファイル 参照を挿入",
    "show or switch the UI/agent language": "UI・エージェントの言語を表示・切替",
    "Welcome to {0}.": "{0} へようこそ。",
    "  /                search EVERYTHING — commands · agents · files · models · themes": "  /                すべて検索 — コマンド · エージェント · ファイル · モデル · テーマ",
    "  ctrl+e / /files  explorer — walk files · agents · sessions · web with the mouse": "  ctrl+e / /files  エクスプローラー — マウスでファイル · エージェント · セッション · web を巡回",
    "  /quick <task>    plan + implement": "  /quick <タスク>   計画して実装",
    "  /moa <task>      multiple agents, one synthesis": "  /moa <タスク>     複数のエージェント、ひとつの統合回答",
    "  agent:<name> …   delegate to one agent directly": "  agent:<名前> …    特定のエージェントに直接委任",
    "  ?                all shortcuts": "  ?                すべてのショートカット",
    "small: {0} · code: {1}": "small: {0} · コード: {1}",
    "\\n/history to review · /clear to reset": "\\n/history で確認 · /clear でリセット",
    // app: actions + menus
    "theme → {0} (saved)": "テーマ → {0} (保存済み)",
    "{0} model → {1} (this session)": "{0} モデル → {1} (このセッション)",
    "session pointer → {0}. Restart ra to open it.": "セッションポインタ → {0}。再起動すると開きます。",
    "session switch failed: {0}": "セッション切替に失敗: {0}",
    "Search everything": "すべて検索",
    "commands · files · agents · models · themes": "コマンド · ファイル · エージェント · モデル · テーマ",
    "Explorer": "エクスプローラー",
    "files · agents · sessions · web": "ファイル · エージェント · セッション · web",
    "Themes": "テーマ",
    "{0} looks, live preview": "{0} 種の見た目、ライブプレビュー",
    "Models": "モデル",
    "Agents": "エージェント",
    "Shortcuts": "ショートカット",
    "Clear screen": "画面をクリア",
    "Cancel task": "タスクをキャンセル",
    "Quit RA": "RA を終了",
    "cancelled — prompt discarded": "キャンセル済み — プロンプトは破棄されました",
    "mixture skipped — answering normally": "ミクスチャーをスキップ — 通常どおり回答",
    "unknown command {0} — press / to search": "不明なコマンド {0} — / を押して検索",
    "You're set. Press / any time to search everything.": "準備完了。いつでも / ですべてを検索できます。",
    "TIP: {0}": "ヒント: {0}",
    "search failed: {0}": "検索に失敗: {0}",
    "\\r\\nsplash error: {0}\\r\\n": "\\r\\nスプラッシュエラー: {0}\\r\\n",
    "Introduce yourself as the {0} agent in one short paragraph.": "{0} エージェントとして短い段落で自己紹介してください。",
    // mixture menu
    "Run as mixture?": "ミクスチャーとして実行?",
    "Fan out across {0} models": "{0} モデルへファンアウト",
    "{0} — critics {1} · est {2}": "{0} — 批評者 {1} · 推定 {2}",
    "subscription/free": "サブスクリプション/無料",
    "Just answer normally": "通常どおり回答",
    "single-lane orchestrator": "単一レーンのオーケストレーター",
    // setup wizard (app)
    "  {0} {1}:{2} {3}": "  {0} {1}:{2} {3}",
    "{0} · {1} models · {2}ms": "{0} · {1} モデル · {2}ms",
    "{0} · not running": "{0} · 未実行",
    "  {0} scanning {1} … ({2} found so far)": "  {0} {1} をスキャン中 … (現時点で {2} 件)",
    "  No local network interface found — LAN scan skipped.": "  ローカルネットワークインターフェースが見つかりません — LAN スキャンをスキップ。",
    "no local server found — cloud config available via `ra setup` in a terminal": "ローカルサーバーが見つかりません — ターミナルで `ra setup` からクラウド設定が可能",
    "skipped — nothing saved": "スキップ — 何も保存されていません",
    "  {0} small host unreachable — pick another model or skip": "  {0} small のホストに到達できません — 別のモデルを選ぶかスキップ",
    "  {0} saved → {1}": "  {0} 保存 → {1}",
    "  {0} setup error: {1}": "  {0} セットアップエラー: {1}",
    "setup {0}": "セットアップ {0}",
    // context / telemetry / misc
    "context ──{0}\\n{1}\\n  TOTAL: {2} tok · ${3}": "コンテキスト ──{0}\\n{1}\\n  合計: {2} tok · ${3}",
    "↳ streamed above": "↳ 上にストリーム表示済み",
    "RA: task done": "RA: タスク完了",
    // /lang
    "language: {0}": "言語: {0}",
    "supported: {0}": "対応: {0}",
    "usage: /lang <code> — e.g. /lang pt-BR": "使い方: /lang <コード> — 例: /lang ja",
    "language → {0} (locked — agent replies follow on the next turn)": "言語 → {0} (ロック済み — エージェントの応答は次のターンから反映)",
    "unsupported language: {0} — supported: {1}": "未対応の言語: {0} — 対応: {1}",
    // tips
    "press / to search EVERYTHING — commands, files, agents, models, themes": "/ ですべて検索 — コマンド、ファイル、エージェント、モデル、テーマ",
    "right-click anywhere for the context menu": "どこでも右クリックでコンテキストメニュー",
    "? shows every shortcut": "? ですべてのショートカットを表示",
    "agent:ptah <task> delegates straight to the coder agent": "agent:ptah <タスク> でコーダーエージェントに直接委任",
    "@src/app.ts attaches a file to your prompt": "@src/app.ts でファイルをプロンプトに添付",
    "/theme re-skins RA instantly — it stays after restart": "/theme で RA の見た目を即変更 — 再起動後も保持されます",
    "/moa asks several agents and synthesizes one answer": "/moa は複数のエージェントに尋ねてひとつの回答に統合",
  },
  de: {
    // chrome
    "working": "arbeite",
    "working…": "arbeite…",
    "/ search · ? shortcuts": "/ suchen · ? Kürzel",
    "no model — run ra setup": "kein Modell — ra setup ausführen",
    "search": "suchen",
    "palette": "Palette",
    "explorer": "Explorer",
    "keys": "Tasten",
    "cancel": "abbrechen",
    "close": "schließen",
    "quit": "beenden",
    "busy": "beschäftigt",
    // explorer tabs + panes
    "file": "Datei",
    "agents": "Agenten",
    "sessions": "Sitzungen",
    "web": "Web",
    "msg": "Nachr.",
    "click a file on the left to preview it": "klicke links eine Datei an, um sie vorzuschauen",
    "symbol outline {0} {1} agents {2} sessions {2} /web search in the tabs above": "Symbol-Gliederung {0} {1} Agenten {2} Sitzungen {2} /web-Suche in den Tabs oben",
    "{0} lines {1} {2} symbols": "{0} Zeilen {1} {2} Symbole",
    "(no description)": "(keine Beschreibung)",
    "delegate: agent:{0} <task> in the prompt": "delegieren: agent:{0} <Aufgabe> im Prompt",
    "esc/back: back to the catalog": "esc/zurück: zurück zum Katalog",
    "agent catalog — click one for its card": "Agenten-Katalog — anklicken für die Karte",
    "agent catalog - click one for its card": "Agenten-Katalog - anklicken für die Karte",
    "sessions — click to switch (restart ra to reopen)": "Sitzungen — anklicken zum Wechseln (Neustart von ra öffnet sie wieder)",
    "sessions - click to switch (restart ra to reopen)": "Sitzungen - anklicken zum Wechseln (Neustart von ra öffnet sie wieder)",
    "  (no saved sessions)": "  (keine gespeicherten Sitzungen)",
    "web: {0}": "Web: {0}",
    "type /web <query> in the prompt to search": "gib /web <Suche> im Prompt ein, um zu suchen",
    "fetching…": "lade…",
    "fetching...": "lade...",
    "── content ──": "── Inhalt ──",
    "-- content --": "-- Inhalt --",
    "── fetched page (text) · click another result to switch ──": "── geladene Seite (Text) · anderes Ergebnis anklicken zum Wechseln ──",
    "-- fetched page (text) - click another result to switch --": "-- geladene Seite (Text) - anderes Ergebnis anklicken zum Wechseln --",
    "  (no results)": "  (keine Ergebnisse)",
    "  q close · tab switch": "  q schließen · Tab wechseln",
    "  q close - tab switch": "  q schließen - Tab wechseln",
    // splash
    "v{0}  ·  press any key to begin": "v{0}  ·  beliebige Taste zum Starten",
    "no model yet — run ra setup after this screen": "noch kein Modell — nach diesem Bildschirm ra setup ausführen",
    // tree
    "╭ subagents ──────────────": "╭ Unteragenten ───────────",
    // shortcuts overlay
    "search everything — commands, agents, files, models, themes": "alles durchsuchen — Befehle, Agenten, Dateien, Modelle, Themen",
    "open the palette": "Palette öffnen",
    "explorer — walk the workspace, agents, sessions, web with the mouse": "Explorer — Workspace, Agenten, Sitzungen und Web mit der Maus erkunden",
    "this shortcuts panel": "dieses Kürzel-Panel",
    "complete the highlighted palette entry": "den markierten Palette-Eintrag vervollständigen",
    "close overlay · cancel the running task": "Overlay schließen · laufende Aufgabe abbrechen",
    "cancel task / clear input": "Aufgabe abbrechen / Eingabe leeren",
    "quit RA": "RA beenden",
    "clear the screen": "Bildschirm leeren",
    "clear the input line": "Eingabezeile leeren",
    "scroll history or palette · ↑ in the input recalls previous prompts": "Verlauf oder Palette scrollen · ↑ in der Eingabe ruft frühere Prompts zurück",
    "context menu at the mouse": "Kontextmenü an der Mausposition",
    "logo = main menu · model chips = model menu": "Logo = Hauptmenü · Modell-Chips = Modellmenü",
    "scroll the conversation": "Unterhaltung scrollen",
    "delegate directly to one agent": "direkt an einen Agenten delegieren",
    "attach a project file to the prompt": "eine Projektdatei an den Prompt anhängen",
    "run a shell command (standard tools apply)": "einen Shell-Befehl ausführen (Standard-Werkzeuge gelten)",
    "  ?  RA shortcuts — click or press any key to close  ": "  ?  RA-Kürzel — klicken oder beliebige Taste zum Schließen  ",
    "  theme: {0} — change with /theme or the theme menu": "  Thema: {0} — wechsle mit /theme oder dem Themenmenü",
    "  press any key to close  ": "  beliebige Taste zum Schließen  ",
    // onboarding
    "  Welcome to RA ({0})": "  Willkommen bei RA ({0})",
    "  the swiss-army terminal agent — for first-timers and pros": "  der Taschenmesser-Terminal-Agent — für Einsteiger und Profis",
    "  Step 2/3 — pick a look (↑↓ + enter, or click):": "  Schritt 2/3 — wähle ein Aussehen (↑↓ + Enter oder klicken):",
    "  enter confirms · you can change it any time with /theme": "  Enter bestätigt · jederzeit mit /theme änderbar",
    "  Step 3/3 — what do you want to do first? (click or ↑↓ + enter)": "  Schritt 3/3 — was möchtest du zuerst tun? (klicken oder ↑↓ + Enter)",
    "Build something": "Etwas bauen",
    "describe an app — RA plans, codes and verifies it": "beschreibe eine App — RA plant, programmiert und prüft sie",
    "Get opinions": "Meinungen einholen",
    "several agents review a problem and synthesize": "mehrere Agenten prüfen ein Problem und fassen zusammen",
    "Just chat": "Einfach plaudern",
    "type anything — RA answers and can use tools": "tippe irgendetwas — RA antwortet und kann Werkzeuge nutzen",
    "  ? shows every shortcut · / searches everything": "  ? zeigt alle Kürzel · / durchsucht alles",
    // setup overlay
    "  Step 1/3 — find your models": "  Schritt 1/3 — finde deine Modelle",
    "  scanning…": "  scanne…",
    "  Scan my local network for AI servers?": "  Mein lokales Netzwerk nach KI-Servern durchsuchen?",
    "Yes — scan this /24 for Ollama / LM Studio / llama.cpp": "Ja — dieses /24 nach Ollama / LM Studio / llama.cpp scannen",
    "   No — localhost only": "   Nein — nur localhost",
    "  No local server found. Use a cloud provider?": "  Kein lokaler Server gefunden. Cloud-Anbieter nutzen?",
    "Skip for now — local-only / later (ra setup)": "Vorerst überspringen — nur lokal / später (ra setup)",
    "  Pick your lanes — small detects, big fixes:": "  Wähle deine Lanes — small erkennt, big repariert:",
    "small  {0}": "small  {0}",
    "small  (none found)": "small  (keine gefunden)",
    "big    {0}": "big    {0}",
    "big    unset (local-only)": "big    nicht gesetzt (nur lokal)",
    "Finish — test + save": "Fertig — testen + speichern",
    "  s skip · esc skip setup · ↑↓ + enter selects": "  s überspringen · esc Setup überspringen · ↑↓ + Enter wählt aus",
    // app: statuses + palette + welcome
    "orchestrating…": "orchestriere…",
    "responding…": "antworte…",
    "cancelling…": "breche ab…",
    "finishing…": "stelle fertig…",
    "{0} working…": "{0} arbeitet…",
    "no model ": "kein Modell ",
    "  no matches — keep typing": "  keine Treffer — tippe weiter",
    "  ↑↓ select · enter run · tab insert · esc close · mouse clickable ({0})": "  ↑↓ auswählen · Enter ausführen · Tab einfügen · Esc schließen · per Maus klickbar ({0})",
    " search everything — commands · agents · files · models · sessions · themes ": " alles durchsuchen — Befehle · Agenten · Dateien · Modelle · Sitzungen · Themen ",
    "open this palette": "diese Palette öffnen",
    "plan + implement a task": "eine Aufgabe planen und umsetzen",
    "multiple agents, one synthesis": "mehrere Agenten, eine Synthese",
    "custom command · agent: {0}": "eigener Befehl · Agent: {0}",
    "delegate a task": "eine Aufgabe delegieren",
    "{0} · accent {1}": "{0} · Akzent {1}",
    "find local AI servers and pick small/big": "lokale KI-Server finden und small/big wählen",
    "forget the saved choice and scan again": "die gespeicherte Wahl verwerfen und neu scannen",
    "pick a different detector model": "ein anderes Erkennungsmodell wählen",
    "pick a different fixer model": "ein anderes Reparaturmodell wählen",
    "use as implementation model": "als Implementierungsmodell verwenden",
    "use as planning model": "als Planungsmodell verwenden",
    "explorer — walk the workspace with the mouse": "Explorer — den Workspace mit der Maus erkunden",
    "web search in the explorer (Brave/Tavily key)": "Websuche im Explorer (Brave/Tavily-Schlüssel)",
    "insert @file reference": "@Datei-Referenz einfügen",
    "show or switch the UI/agent language": "die UI-/Agentensprache anzeigen oder wechseln",
    "Welcome to {0}.": "Willkommen bei {0}.",
    "  /                search EVERYTHING — commands · agents · files · models · themes": "  /                ALLES durchsuchen — Befehle · Agenten · Dateien · Modelle · Themen",
    "  ctrl+e / /files  explorer — walk files · agents · sessions · web with the mouse": "  ctrl+e / /files  Explorer — Dateien · Agenten · Sitzungen · Web mit der Maus erkunden",
    "  /quick <task>    plan + implement": "  /quick <Aufgabe> planen + umsetzen",
    "  /moa <task>      multiple agents, one synthesis": "  /moa <Aufgabe>    mehrere Agenten, eine Synthese",
    "  agent:<name> …   delegate to one agent directly": "  agent:<Name> …   direkt an einen Agenten delegieren",
    "  ?                all shortcuts": "  ?                alle Kürzel",
    "small: {0} · code: {1}": "small: {0} · Code: {1}",
    "\\n/history to review · /clear to reset": "\\n/history zum Ansehen · /clear zum Zurücksetzen",
    // app: actions + menus
    "theme → {0} (saved)": "Thema → {0} (gespeichert)",
    "{0} model → {1} (this session)": "{0}-Modell → {1} (diese Sitzung)",
    "session pointer → {0}. Restart ra to open it.": "Sitzungszeiger → {0}. Starte ra neu, um sie zu öffnen.",
    "session switch failed: {0}": "Sitzungswechsel fehlgeschlagen: {0}",
    "Search everything": "Alles durchsuchen",
    "commands · files · agents · models · themes": "Befehle · Dateien · Agenten · Modelle · Themen",
    "Explorer": "Explorer",
    "files · agents · sessions · web": "Dateien · Agenten · Sitzungen · Web",
    "Themes": "Themen",
    "{0} looks, live preview": "{0} Looks, Live-Vorschau",
    "Models": "Modelle",
    "Agents": "Agenten",
    "Shortcuts": "Kürzel",
    "Clear screen": "Bildschirm leeren",
    "Cancel task": "Aufgabe abbrechen",
    "Quit RA": "RA beenden",
    "cancelled — prompt discarded": "abgebrochen — Prompt verworfen",
    "mixture skipped — answering normally": "Mixture übersprungen — antworte normal",
    "unknown command {0} — press / to search": "unbekannter Befehl {0} — drücke / zum Suchen",
    "You're set. Press / any time to search everything.": "Alles bereit. Drücke jederzeit /, um alles zu durchsuchen.",
    "TIP: {0}": "TIPP: {0}",
    "search failed: {0}": "Suche fehlgeschlagen: {0}",
    "\\r\\nsplash error: {0}\\r\\n": "\\r\\nSplash-Fehler: {0}\\r\\n",
    "Introduce yourself as the {0} agent in one short paragraph.": "Stelle dich als {0}-Agent in einem kurzen Absatz vor.",
    // mixture menu
    "Run as mixture?": "Als Mixture ausführen?",
    "Fan out across {0} models": "Auf {0} Modelle verteilen",
    "{0} — critics {1} · est {2}": "{0} — Kritiker {1} · geschätzt {2}",
    "subscription/free": "Abo/kostenlos",
    "Just answer normally": "Einfach normal antworten",
    "single-lane orchestrator": "Single-Lane-Orchestrator",
    // setup wizard (app)
    "  {0} {1}:{2} {3}": "  {0} {1}:{2} {3}",
    "{0} · {1} models · {2}ms": "{0} · {1} Modelle · {2}ms",
    "{0} · not running": "{0} · läuft nicht",
    "  {0} scanning {1} … ({2} found so far)": "  {0} scanne {1} … (bisher {2} gefunden)",
    "  No local network interface found — LAN scan skipped.": "  Keine lokale Netzwerkschnittstelle gefunden — LAN-Scan übersprungen.",
    "no local server found — cloud config available via `ra setup` in a terminal": "kein lokaler Server gefunden — Cloud-Konfiguration über `ra setup` im Terminal verfügbar",
    "skipped — nothing saved": "übersprungen — nichts gespeichert",
    "  {0} small host unreachable — pick another model or skip": "  {0} Small-Host nicht erreichbar — anderes Modell wählen oder überspringen",
    "  {0} saved → {1}": "  {0} gespeichert → {1}",
    "  {0} setup error: {1}": "  {0} Setup-Fehler: {1}",
    "setup {0}": "Setup {0}",
    // context / telemetry / misc
    "context ──{0}\\n{1}\\n  TOTAL: {2} tok · ${3}": "Kontext ──{0}\\n{1}\\n  GESAMT: {2} tok · ${3}",
    "↳ streamed above": "↳ oben gestreamt",
    "RA: task done": "RA: Aufgabe erledigt",
    // /lang
    "language: {0}": "Sprache: {0}",
    "supported: {0}": "unterstützt: {0}",
    "usage: /lang <code> — e.g. /lang pt-BR": "Verwendung: /lang <Code> — z. B. /lang de",
    "language → {0} (locked — agent replies follow on the next turn)": "Sprache → {0} (gesperrt — Agent-Antworten folgen ab dem nächsten Zug)",
    "unsupported language: {0} — supported: {1}": "nicht unterstützte Sprache: {0} — unterstützt: {1}",
    // tips
    "press / to search EVERYTHING — commands, files, agents, models, themes": "drücke /, um ALLES zu durchsuchen — Befehle, Dateien, Agenten, Modelle, Themen",
    "right-click anywhere for the context menu": "klicke überall mit der rechten Maustaste für das Kontextmenü",
    "? shows every shortcut": "? zeigt alle Kürzel",
    "agent:ptah <task> delegates straight to the coder agent": "agent:ptah <Aufgabe> delegiert direkt an den Coder-Agenten",
    "@src/app.ts attaches a file to your prompt": "@src/app.ts hängt eine Datei an deinen Prompt",
    "/theme re-skins RA instantly — it stays after restart": "/theme gibt RA sofort ein neues Aussehen — bleibt nach dem Neustart",
    "/moa asks several agents and synthesizes one answer": "/moa fragt mehrere Agenten und fasst zu einer Antwort zusammen",
  },
  pl: {
    // chrome
    "working": "pracuję",
    "working…": "pracuję…",
    "/ search · ? shortcuts": "/ szukaj · ? skróty",
    "no model — run ra setup": "brak modelu — uruchom ra setup",
    "search": "szukaj",
    "palette": "paleta",
    "explorer": "eksplorator",
    "keys": "klawisze",
    "cancel": "anuluj",
    "close": "zamknij",
    "quit": "wyjdź",
    "busy": "zajęty",
    // explorer tabs + panes
    "file": "plik",
    "agents": "agenty",
    "sessions": "sesje",
    "web": "web",
    "msg": "wiad.",
    "click a file on the left to preview it": "kliknij plik po lewej, aby zobaczyć podgląd",
    "symbol outline {0} {1} agents {2} sessions {2} /web search in the tabs above": " konspekt symboli {0} agenty: {1} {2} sesje: {2} wyszukiwanie /web w zakładkach wyżej",
    "{0} lines {1} {2} symbols": "{0} linii {1} {2} symboli",
    "(no description)": "(brak opisu)",
    "delegate: agent:{0} <task> in the prompt": "deleguj: agent:{0} <zadanie> w prompcie",
    "esc/back: back to the catalog": "esc/wstecz: powrót do katalogu",
    "agent catalog — click one for its card": "katalog agentów — kliknij, aby zobaczyć kartę",
    "agent catalog - click one for its card": "katalog agentów - kliknij, aby zobaczyć kartę",
    "sessions — click to switch (restart ra to reopen)": "sesje — kliknij, aby przełączyć (restart ra otwiera ponownie)",
    "sessions - click to switch (restart ra to reopen)": "sesje - kliknij, aby przełączyć (restart ra otwiera ponownie)",
    "  (no saved sessions)": "  (brak zapisanych sesji)",
    "web: {0}": "web: {0}",
    "type /web <query> in the prompt to search": "wpisz /web <zapytanie> w prompcie, aby szukać",
    "fetching…": "pobieram…",
    "fetching...": "pobieram...",
    "── content ──": "── zawartość ──",
    "-- content --": "-- zawartość --",
    "── fetched page (text) · click another result to switch ──": "── pobrana strona (tekst) · kliknij inny wynik, aby przełączyć ──",
    "-- fetched page (text) - click another result to switch --": "-- pobrana strona (tekst) - kliknij inny wynik, aby przełączyć --",
    "  (no results)": "  (brak wyników)",
    "  q close · tab switch": "  q zamknij · tab zmiana zakładki",
    "  q close - tab switch": "  q zamknij - tab zmiana zakładki",
    // splash
    "v{0}  ·  press any key to begin": "v{0}  ·  naciśnij dowolny klawisz, aby zacząć",
    "no model yet — run ra setup after this screen": "brak modelu — po tym ekranie uruchom ra setup",
    // tree
    "╭ subagents ──────────────": "╭ podagenty ─────────────",
    // shortcuts overlay
    "search everything — commands, agents, files, models, themes": "szukaj wszystkiego — polecenia, agenty, pliki, modele, motywy",
    "open the palette": "otwórz paletę",
    "explorer — walk the workspace, agents, sessions, web with the mouse": "eksplorator — przeglądaj projekt, agenty, sesje i web myszą",
    "this shortcuts panel": "ten panel skrótów",
    "complete the highlighted palette entry": "uzupełnij podświetloną pozycję palety",
    "close overlay · cancel the running task": "zamknij nakładkę · anuluj bieżące zadanie",
    "cancel task / clear input": "anuluj zadanie / wyczyść wejście",
    "quit RA": "wyjdź z RA",
    "clear the screen": "wyczyść ekran",
    "clear the input line": "wyczyść linię wejścia",
    "scroll history or palette · ↑ in the input recalls previous prompts": "przewijaj historię lub paletę · ↑ w wejściu przywraca poprzednie prompty",
    "context menu at the mouse": "menu kontekstowe przy kursorze",
    "logo = main menu · model chips = model menu": "logo = menu główne · chipsy modeli = menu modeli",
    "scroll the conversation": "przewijaj rozmowę",
    "delegate directly to one agent": "deleguj bezpośrednio do agenta",
    "attach a project file to the prompt": "dołącz plik projektu do promptu",
    "run a shell command (standard tools apply)": "wykonaj polecenie powłoki (obowiązują standardowe narzędzia)",
    "  ?  RA shortcuts — click or press any key to close  ": "  ?  Skróty RA — kliknij lub naciśnij dowolny klawisz, aby zamknąć  ",
    "  theme: {0} — change with /theme or the theme menu": "  motyw: {0} — zmień przez /theme lub menu motywów",
    "  press any key to close  ": "  naciśnij dowolny klawisz, aby zamknąć  ",
    // onboarding
    "  Welcome to RA ({0})": "  Witamy w RA ({0})",
    "  the swiss-army terminal agent — for first-timers and pros": "  terminalowy agent scyzoryk — dla początkujących i profesjonalistów",
    "  Step 2/3 — pick a look (↑↓ + enter, or click):": "  Krok 2/3 — wybierz wygląd (↑↓ + enter albo kliknięcie):",
    "  enter confirms · you can change it any time with /theme": "  enter zatwierdza · możesz zmienić w każdej chwili przez /theme",
    "  Step 3/3 — what do you want to do first? (click or ↑↓ + enter)": "  Krok 3/3 — co chcesz zrobić najpierw? (kliknięcie albo ↑↓ + enter)",
    "Build something": "Zbuduj coś",
    "describe an app — RA plans, codes and verifies it": "opisz aplikację — RA planuje, koduje i weryfikuje",
    "Get opinions": "Zdobądź opinie",
    "several agents review a problem and synthesize": "kilka agentów przegląda problem i syntezyzuje",
    "Just chat": "Po prostu porozmawiaj",
    "type anything — RA answers and can use tools": "wpisz cokolwiek — RA odpowiada i może używać narzędzi",
    "  ? shows every shortcut · / searches everything": "  ? pokazuje wszystkie skróty · / szuka wszystkiego",
    // setup overlay
    "  Step 1/3 — find your models": "  Krok 1/3 — znajdź swoje modele",
    "  scanning…": "  skanuję…",
    "  Scan my local network for AI servers?": "  Przeszukać moją sieć lokalną w poszukiwaniu serwerów AI?",
    "Yes — scan this /24 for Ollama / LM Studio / llama.cpp": "Tak — przeskanuj tę /24 pod kątem Ollama / LM Studio / llama.cpp",
    "   No — localhost only": "   Nie — tylko localhost",
    "  No local server found. Use a cloud provider?": "  Nie znaleziono lokalnego serwera. Użyć dostawcy chmury?",
    "Skip for now — local-only / later (ra setup)": "Pomiń na razie — tylko lokalnie / później (ra setup)",
    "  Pick your lanes — small detects, big fixes:": "  Wybierz tory — small wykrywa, big naprawia:",
    "small  {0}": "small  {0}",
    "small  (none found)": "small  (żaden nie znaleziony)",
    "big    {0}": "big    {0}",
    "big    unset (local-only)": "big    nieustawiony (tylko lokalnie)",
    "Finish — test + save": "Zakończ — testuj + zapisz",
    "  s skip · esc skip setup · ↑↓ + enter selects": "  s pomiń · esc pomiń konfigurację · ↑↓ + enter wybiera",
    // app: statuses + palette + welcome
    "orchestrating…": "orkiestruję…",
    "responding…": "odpowiadam…",
    "cancelling…": "anuluję…",
    "finishing…": "kończę…",
    "{0} working…": "{0} pracuje…",
    "no model ": "brak modelu ",
    "  no matches — keep typing": "  brak dopasowań — pisz dalej",
    "  ↑↓ select · enter run · tab insert · esc close · mouse clickable ({0})": "  ↑↓ wybierz · enter uruchom · tab wstaw · esc zamknij · klikalne myszą ({0})",
    " search everything — commands · agents · files · models · sessions · themes ": " szukaj wszystkiego — polecenia · agenty · pliki · modele · sesje · motywy ",
    "open this palette": "otwórz tę paletę",
    "plan + implement a task": "zaplanuj i zaimplementuj zadanie",
    "multiple agents, one synthesis": "wiele agentów, jedna synteza",
    "custom command · agent: {0}": "własne polecenie · agent: {0}",
    "delegate a task": "deleguj zadanie",
    "{0} · accent {1}": "{0} · akcent {1}",
    "find local AI servers and pick small/big": "znajdź lokalne serwery AI i wybierz small/big",
    "forget the saved choice and scan again": "porzuć zapisany wybór i skanuj ponownie",
    "pick a different detector model": "wybierz inny model detektor",
    "pick a different fixer model": "wybierz inny model naprawczy",
    "use as implementation model": "użyj jako model implementacji",
    "use as planning model": "użyj jako model planowania",
    "explorer — walk the workspace with the mouse": "eksplorator — przeglądaj projekt myszą",
    "web search in the explorer (Brave/Tavily key)": "wyszukiwanie w web w eksploratorze (klucz Brave/Tavily)",
    "insert @file reference": "wstaw odwołanie @plik",
    "show or switch the UI/agent language": "pokaż lub przełącz język UI/agenta",
    "Welcome to {0}.": "Witamy w {0}.",
    "  /                search EVERYTHING — commands · agents · files · models · themes": "  /                szukaj WSZYSTKIEGO — polecenia · agenty · pliki · modele · motywy",
    "  ctrl+e / /files  explorer — walk files · agents · sessions · web with the mouse": "  ctrl+e / /files  eksplorator — przeglądaj pliki · agenty · sesje · web myszą",
    "  /quick <task>    plan + implement": "  /quick <zadanie> zaplanuj + zaimplementuj",
    "  /moa <task>      multiple agents, one synthesis": "  /moa <zadanie>    wiele agentów, jedna synteza",
    "  agent:<name> …   delegate to one agent directly": "  agent:<nazwa> …   deleguj bezpośrednio do agenta",
    "  ?                all shortcuts": "  ?                wszystkie skróty",
    "small: {0} · code: {1}": "small: {0} · kod: {1}",
    "\\n/history to review · /clear to reset": "\\n/history do przeglądu · /clear do resetu",
    // app: actions + menus
    "theme → {0} (saved)": "motyw → {0} (zapisany)",
    "{0} model → {1} (this session)": "model {0} → {1} (ta sesja)",
    "session pointer → {0}. Restart ra to open it.": "wskaźnik sesji → {0}. Zrestartuj ra, aby ją otworzyć.",
    "session switch failed: {0}": "nie udało się przełączyć sesji: {0}",
    "Search everything": "Szukaj wszystkiego",
    "commands · files · agents · models · themes": "polecenia · pliki · agenty · modele · motywy",
    "Explorer": "Eksplorator",
    "files · agents · sessions · web": "pliki · agenty · sesje · web",
    "Themes": "Motywy",
    "{0} looks, live preview": "{0} wyglądów, podgląd na żywo",
    "Models": "Modele",
    "Agents": "Agenty",
    "Shortcuts": "Skróty",
    "Clear screen": "Wyczyść ekran",
    "Cancel task": "Anuluj zadanie",
    "Quit RA": "Wyjdź z RA",
    "cancelled — prompt discarded": "anulowano — prompt odrzucony",
    "mixture skipped — answering normally": "mikstura pominięta — odpowiadam normalnie",
    "unknown command {0} — press / to search": "nieznane polecenie {0} — naciśnij /, aby szukać",
    "You're set. Press / any time to search everything.": "Wszystko gotowe. Naciśnij / w każdej chwili, aby szukać wszystkiego.",
    "TIP: {0}": "WSKAZÓWKA: {0}",
    "search failed: {0}": "wyszukiwanie nie powiodło się: {0}",
    "\\r\\nsplash error: {0}\\r\\n": "\\r\\nbłąd splash: {0}\\r\\n",
    "Introduce yourself as the {0} agent in one short paragraph.": "Przedstaw się jako agent {0} w jednym krótkim akapicie.",
    // mixture menu
    "Run as mixture?": "Uruchomić jako miksturę?",
    "Fan out across {0} models": "Rozprosz na {0} modeli",
    "{0} — critics {1} · est {2}": "{0} — krytycy {1} · szac. {2}",
    "subscription/free": "subskrypcja/darmowe",
    "Just answer normally": "Odpowiedz po prostu normalnie",
    "single-lane orchestrator": "orzestartor jednotorowy",
    // setup wizard (app)
    "  {0} {1}:{2} {3}": "  {0} {1}:{2} {3}",
    "{0} · {1} models · {2}ms": "{0} · {1} modeli · {2}ms",
    "{0} · not running": "{0} · nie działa",
    "  {0} scanning {1} … ({2} found so far)": "  {0} skanuję {1} … (dotąd znaleziono {2})",
    "  No local network interface found — LAN scan skipped.": "  Nie znaleziono lokalnego interfejsu sieciowego — pominięto skan LAN.",
    "no local server found — cloud config available via `ra setup` in a terminal": "nie znaleziono lokalnego serwera — konfiguracja chmury dostępna przez `ra setup` w terminalu",
    "skipped — nothing saved": "pominięto — nic nie zapisano",
    "  {0} small host unreachable — pick another model or skip": "  {0} host small nieosiągalny — wybierz inny model lub pomiń",
    "  {0} saved → {1}": "  {0} zapisano → {1}",
    "  {0} setup error: {1}": "  {0} błąd konfiguracji: {1}",
    "setup {0}": "konfiguracja {0}",
    // context / telemetry / misc
    "context ──{0}\\n{1}\\n  TOTAL: {2} tok · ${3}": "kontekst ──{0}\\n{1}\\n  RAZEM: {2} tok · ${3}",
    "↳ streamed above": "↳ streamowane wyżej",
    "RA: task done": "RA: zadanie gotowe",
    // /lang
    "language: {0}": "język: {0}",
    "supported: {0}": "wspierane: {0}",
    "usage: /lang <code> — e.g. /lang pt-BR": "użycie: /lang <kod> — np. /lang pl",
    "language → {0} (locked — agent replies follow on the next turn)": "język → {0} (zablokowany — odpowiedzi agenta obowiązywać będą od następnej tury)",
    "unsupported language: {0} — supported: {1}": "niewspierany język: {0} — wspierane: {1}",
    // tips
    "press / to search EVERYTHING — commands, files, agents, models, themes": "naciśnij /, aby szukać WSZYSTKIEGO — polecenia, pliki, agenty, modele, motywy",
    "right-click anywhere for the context menu": "kliknij prawym przyciskiem gdziekolwiek, aby otworzyć menu kontekstowe",
    "? shows every shortcut": "? pokazuje wszystkie skróty",
    "agent:ptah <task> delegates straight to the coder agent": "agent:ptah <zadanie> deleguje wprost do agenta kodera",
    "@src/app.ts attaches a file to your prompt": "@src/app.ts dołącza plik do twojego promptu",
    "/theme re-skins RA instantly — it stays after restart": "/theme natychmiast zmienia wygląd RA — zostaje po restarcie",
    "/moa asks several agents and synthesizes one answer": "/moa pyta kilka agentów i syntezuje jedną odpowiedź",
  },
};

let current: Locale = "en";

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/**
 * Translate `key` in the current locale; a missing entry falls back to en
 * (the key itself). `{0}`/`{1}`… placeholders fill from `args` in order.
 */
export function t(key: string, ...args: Array<string | number>): string {
  const table = CATALOGS[current];
  let s = (current !== "en" && table[key]) || key;
  for (let i = 0; i < args.length; i++) s = s.replaceAll(`{${i}}`, String(args[i]));
  return s;
}

/** Map any locale-ish token (env value, Intl result) to a supported locale. Unknown → en. */
export function normalizeLocale(raw: string | undefined | null): Locale {
  if (!raw) return "en";
  const primary = raw.trim().toLowerCase().split(/[._@-]/)[0]!;
  if (primary === "pt") return "pt-BR";
  if (primary === "ja" || primary === "de" || primary === "pl") return primary;
  return "en";
}

export interface DetectSpec {
  env?: Record<string, string | undefined>;
  /** Intl.DateTimeFormat().resolvedOptions().locale stand-in for tests. */
  intlLocale?: string;
}

/**
 * Locale detection: LC_ALL > LANG > Intl.DateTimeFormat().resolvedOptions().
 * locale. Anything unrecognized (C, xx_YY, empty) resolves to en.
 */
export function detectLocale(spec: DetectSpec = {}): Locale {
  const env = spec.env ?? process.env;
  const fromEnv = env.LC_ALL || env.LANG;
  if (fromEnv) return normalizeLocale(fromEnv);
  const intl = spec.intlLocale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
  return normalizeLocale(intl);
}

/** Path of the locale lock — same directory and shape as the tui.json prefs. */
export function localePath(home = homedir()): string {
  return join(home, ".ra", "locale.json");
}

/** Locked locale choice, or null when nothing (or something malformed) is saved. */
export function loadLockedLocale(home = homedir()): Locale | null {
  try {
    const v = JSON.parse(readFileSync(localePath(home), "utf-8")) as { locale?: string };
    return v.locale ? normalizeLocale(String(v.locale)) : null;
  } catch {
    return null;
  }
}

/** Persist the choice (survives restarts) and activate it in this process. */
export function lockLocale(locale: Locale, home = homedir()): void {
  try {
    mkdirSync(join(home, ".ra"), { recursive: true });
    writeFileSync(localePath(home), JSON.stringify({ locale }, null, 2) + "\n");
  } catch {
    /* read-only home — locale still applies to this process */
  }
  current = locale;
}

/**
 * First-run bootstrap: a saved lock wins; otherwise detect and auto-lock so
 * the choice (and the agent output language) is stable across sessions.
 */
export function initLocale(spec: DetectSpec & { home?: string } = {}): Locale {
  const home = spec.home ?? homedir();
  const locked = loadLockedLocale(home);
  if (locked) {
    current = locked;
    return locked;
  }
  const detected = detectLocale(spec);
  lockLocale(detected, home);
  return detected;
}

/**
 * System-prompt directive pinning the agent's OUTPUT language. Empty for en.
 * Input handling is untouched — prompts in any language keep working.
 */
export function languageDirective(locale: Locale = current): string {
  if (locale === "en") return "";
  return `\n\nLanguage: Always respond in ${DIRECTIVE_NAMES[locale]} (${locale}), regardless of the language of the prompt or of tool output.`;
}
