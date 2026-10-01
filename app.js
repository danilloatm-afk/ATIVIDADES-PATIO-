const SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZnlxdmVmem5rcGN2amFlcnRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQ4NjgsImV4cCI6MjEwMTc5MDg2OH0.2Ef6LpZ61WM8myHBYeQGo3TuGqk5C3x36ER_sWRNPS4";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker não registrado:", err));
  });
}

const STATUS_LABEL = { aberto: "Aberto", andamento: "Em andamento", concluido: "Concluído" };
const PRIORIDADE_LABEL = { baixa: "Baixa", media: "Média", alta: "Alta" };

// ---------- login / permissões ----------
// Admin vê e mexe em tudo. Líder só vê/mexe no próprio setor — e isso é
// garantido de verdade pelo RLS do Supabase (política por linha), não só
// escondido na tela. meuPerfil vem da tabela op_perfis depois do login.
let sessaoAtual = null;
let meuPerfil = null;

function souAdmin() {
  return !!meuPerfil && meuPerfil.role === "admin";
}

async function carregarPerfil() {
  const { data, error } = await db.from("op_perfis").select("*").eq("user_id", sessaoAtual.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Seu usuário ainda não tem acesso liberado. Peça para o administrador te cadastrar em Configurações → Usuários.");
  meuPerfil = data;
  if (meuPerfil.role !== "admin") {
    const { data: vinculos, error: errVinculos } = await db.from("op_perfis_setores").select("setor_id").eq("user_id", sessaoAtual.user.id);
    if (errVinculos) throw new Error(errVinculos.message);
    meuPerfil.setorIds = (vinculos || []).map((v) => v.setor_id);
  }
}

function mostrarTelaLogin() {
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("tela-login").classList.remove("hidden");
}

function aplicarPermissoesUI() {
  const admin = souAdmin();
  document.getElementById("card-setores").classList.toggle("hidden", !admin);
  document.getElementById("card-categorias").classList.toggle("hidden", !admin);
  document.getElementById("card-usuarios").classList.toggle("hidden", !admin);
  // Líder também pode ter mais de um setor agora, então o seletor de setor
  // e o de setor do funcionário ficam sempre visíveis/ativos — só as
  // opções disponíveis mudam (RLS já limita o que cada um enxerga).
  document.getElementById("func-setor").classList.remove("hidden");
  document.getElementById("setor-select").disabled = false;
}

async function mostrarApp() {
  document.getElementById("tela-login").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  aplicarPermissoesUI();
  await iniciarDadosApp();
}

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("login-feedback");
  feedback.textContent = "Entrando...";
  feedback.className = "feedback";
  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;
  const { error } = await db.auth.signInWithPassword({ email, password: senha });
  if (error) {
    feedback.textContent = error.message === "Invalid login credentials" ? "Email ou senha incorretos." : "Erro: " + error.message;
    feedback.className = "feedback error";
  } else {
    feedback.textContent = "";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await db.auth.signOut();
});

db.auth.onAuthStateChange(async (_evento, sessao) => {
  sessaoAtual = sessao;
  if (sessaoAtual) {
    try {
      await carregarPerfil();
      await mostrarApp();
    } catch (e) {
      const feedback = document.getElementById("login-feedback");
      feedback.textContent = e.message;
      feedback.className = "feedback error";
      meuPerfil = null;
      await db.auth.signOut();
    }
  } else {
    meuPerfil = null;
    mostrarTelaLogin();
  }
});

// ---------- tema claro/escuro ----------
const LS_TEMA = "op_tema";

function temaEfetivoEscuro(tema) {
  if (tema === "dark") return true;
  if (tema === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function aplicarTema(tema) {
  if (tema === "light" || tema === "dark") {
    document.documentElement.setAttribute("data-theme", tema);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.getElementById("btn-theme-toggle").textContent = temaEfetivoEscuro(tema) ? "☀️" : "🌙";
}

let temaAtual = localStorage.getItem(LS_TEMA) || "auto";
aplicarTema(temaAtual);

document.getElementById("btn-theme-toggle").addEventListener("click", () => {
  temaAtual = temaEfetivoEscuro(temaAtual) ? "light" : "dark";
  localStorage.setItem(LS_TEMA, temaAtual);
  aplicarTema(temaAtual);
});

// ---------- helpers ----------
function comTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function hojeISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function estaAtrasada(atividade) {
  return atividade.status !== "concluido" && atividade.prazo && atividade.prazo < hojeISO();
}

function linkAvaliacao(token) {
  return new URL(`avaliar.html?t=${token}`, location.href).href;
}

function linkAvaliacaoSetor(token) {
  return new URL(`avaliar.html?s=${token}`, location.href).href;
}

function renderEstrelas(nota) {
  return "★".repeat(nota) + "☆".repeat(5 - nota);
}

function linkWhatsapp(numero, mensagem) {
  const digitos = String(numero || "").replace(/\D/g, "");
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

// ---------- setor selecionado (isola painel/atividades por setor) ----------
const LS_SETOR_SELECIONADO = "op_setor_selecionado";
let setoresCache = [];
let setorSelecionadoId = localStorage.getItem(LS_SETOR_SELECIONADO) || "";

async function loadSetores() {
  // O RLS já filtra o que volta aqui: admin recebe todos os setores,
  // líder recebe só os que estão vinculados a ele (tabela
  // op_perfis_setores, política "leitura setores logado") — pode ser mais
  // de um.
  const { data, error } = await comTimeout(db.from("op_setores").select("*").order("ativo", { ascending: false }).order("nome"));
  if (error) throw new Error(error.message);
  setoresCache = data;

  const ativos = setoresCache.filter((s) => s.ativo);
  if (!ativos.some((s) => String(s.id) === String(setorSelecionadoId))) {
    setorSelecionadoId = ativos[0] ? String(ativos[0].id) : "";
  }
  localStorage.setItem(LS_SETOR_SELECIONADO, setorSelecionadoId);

  const sel = document.getElementById("setor-select");
  sel.innerHTML = ativos.length
    ? ativos.map((s) => `<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join("")
    : '<option value="">Nenhum setor cadastrado</option>';
  sel.value = setorSelecionadoId;
}

document.getElementById("setor-select").addEventListener("change", async (e) => {
  setorSelecionadoId = e.target.value;
  localStorage.setItem(LS_SETOR_SELECIONADO, setorSelecionadoId);
  await refreshCadastros();
  loadPainel();
  if (document.getElementById("tab-atividades").classList.contains("active")) loadAtividades();
});

function renderListaSetores() {
  const ul = document.getElementById("lista-setores");
  ul.innerHTML = setoresCache
    .map(
      (s) => `
    <li class="${s.ativo ? "" : "inativo"}">
      <span>${escapeHtml(s.nome)}</span>
      <span>
        <button class="link-btn" data-id="${s.id}" data-acao="copiar-link">copiar link de avaliação</button>
        <a class="link-btn" data-id="${s.id}" data-acao="whatsapp-link" target="_blank" rel="noopener" href="${escapeHtml(
        linkWhatsapp("", `Ajude o setor ${s.nome} a melhorar! Avalie nosso atendimento: ${linkAvaliacaoSetor(s.avaliacao_token)}`)
      )}">whatsapp</a>
        <button class="link-btn" data-id="${s.id}" data-acao="toggle" data-ativo="${s.ativo ? 1 : 0}">${s.ativo ? "desativar" : "reativar"}</button>
      </span>
    </li>`
    )
    .join("");
  ul.querySelectorAll('[data-acao="toggle"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novoAtivo = btn.dataset.ativo !== "1";
      await db.from("op_setores").update({ ativo: novoAtivo }).eq("id", btn.dataset.id);
      await loadSetores();
      renderListaSetores();
      loadPainel();
    });
  });
  ul.querySelectorAll('[data-acao="copiar-link"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const setor = setoresCache.find((s) => String(s.id) === String(btn.dataset.id));
      if (!setor) return;
      const link = linkAvaliacaoSetor(setor.avaliacao_token);
      try {
        await navigator.clipboard.writeText(link);
        const textoOriginal = btn.textContent;
        btn.textContent = "link copiado!";
        setTimeout(() => (btn.textContent = textoOriginal), 2000);
      } catch {
        prompt("Copie o link de avaliação do setor:", link);
      }
    });
  });
}

document.getElementById("form-setor").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("setor-nome").value.trim();
  if (!nome) return;
  const { error } = await db.from("op_setores").insert({ nome });
  if (error) return alert("Erro ao adicionar setor: " + error.message);
  document.getElementById("setor-nome").value = "";
  await loadSetores();
  renderListaSetores();
  loadPainel();
});

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "painel") loadPainel();
    if (btn.dataset.tab === "atividades") loadAtividades();
    if (btn.dataset.tab === "alinhamentos") loadAlinhamentos();
  });
});

// ---------- caches de cadastro ----------
let funcionariosCache = [];
let categoriasCache = [];

async function loadFuncionarios() {
  if (!setorSelecionadoId) {
    funcionariosCache = [];
    return;
  }
  const { data, error } = await comTimeout(
    db.from("op_funcionarios").select("*").eq("setor_id", setorSelecionadoId).order("ativo", { ascending: false }).order("nome")
  );
  if (error) throw new Error(error.message);
  funcionariosCache = data;
}

async function loadCategorias() {
  const { data, error } = await comTimeout(db.from("op_categorias").select("*").order("ativo", { ascending: false }).order("nome"));
  if (error) throw new Error(error.message);
  categoriasCache = data;
}

function atualizarSelectsCadastro() {
  const funcAtivos = funcionariosCache.filter((f) => f.ativo);
  const catAtivas = categoriasCache.filter((c) => c.ativo);

  const optsFunc = funcAtivos.map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join("");
  const optsCat = catAtivas.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("");

  document.getElementById("ativ-funcionario").innerHTML = optsFunc;
  document.getElementById("ativ-categoria").innerHTML = '<option value="">Sem categoria</option>' + optsCat;

  document.getElementById("fil-funcionario").innerHTML =
    '<option value="">Todos os responsáveis</option>' + funcionariosCache.map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join("");
  document.getElementById("fil-categoria").innerHTML =
    '<option value="">Todas as categorias</option>' + categoriasCache.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("");
  document.getElementById("alin-funcionario").innerHTML = '<option value="">Setor em geral</option>' + optsFunc;

  // setoresCache já vem filtrado pelo RLS (admin vê todos, líder só os
  // dele), então o select do funcionário usa a mesma lista pros dois papéis.
  const ativosSetores = setoresCache.filter((s) => s.ativo);
  const optsSetor = ativosSetores.map((s) => `<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join("");
  const selFuncSetor = document.getElementById("func-setor");
  selFuncSetor.innerHTML = optsSetor;
  selFuncSetor.value = setorSelecionadoId;
  if (souAdmin()) {
    document.getElementById("usu-setor").innerHTML = optsSetor;
  }
}

// ---------- QR code de avaliação do setor ----------
let linkAvaliacaoSetorAtual = "";

function atualizarCardQrSetor() {
  const card = document.getElementById("qr-avaliacao-card");
  const setor = setoresCache.find((s) => String(s.id) === String(setorSelecionadoId));
  if (!setor || !setor.avaliacao_token) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  linkAvaliacaoSetorAtual = linkAvaliacaoSetor(setor.avaliacao_token);
  document.getElementById("qr-avaliacao-link").value = linkAvaliacaoSetorAtual;
  document.getElementById("qr-avaliacao-setor-nome").textContent = `Avalie o setor de ${setor.nome}`;
  const img = document.getElementById("qr-avaliacao-setor");
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(linkAvaliacaoSetorAtual)}`;
  img.alt = `QR code para avaliar o setor ${setor.nome}`;
  document.getElementById("btn-whatsapp-link-setor").href = linkWhatsapp(
    "",
    `Ajude o setor ${setor.nome} a melhorar! Avalie nosso atendimento: ${linkAvaliacaoSetorAtual}`
  );
}

document.getElementById("btn-copiar-link-setor").addEventListener("click", async () => {
  if (!linkAvaliacaoSetorAtual) return;
  const btn = document.getElementById("btn-copiar-link-setor");
  try {
    await navigator.clipboard.writeText(linkAvaliacaoSetorAtual);
    const textoOriginal = btn.textContent;
    btn.textContent = "Copiado!";
    setTimeout(() => (btn.textContent = textoOriginal), 2000);
  } catch {
    prompt("Copie o link de avaliação do setor:", linkAvaliacaoSetorAtual);
  }
});

document.getElementById("btn-imprimir-qr-setor").addEventListener("click", () => {
  document.body.classList.add("imprimir-qr-setor");
  window.print();
  document.body.classList.remove("imprimir-qr-setor");
});

document.getElementById("btn-exportar-avaliacoes-pdf").addEventListener("click", () => {
  const setor = setoresCache.find((s) => String(s.id) === String(setorSelecionadoId));
  const cabecalho = document.getElementById("imprimir-avaliacoes-cabecalho");
  cabecalho.innerHTML = `
    <h2>Avaliações do setor ${setor ? escapeHtml(setor.nome) : ""}</h2>
    <p>Gerado em ${new Date().toLocaleDateString("pt-BR")}</p>
  `;
  document.body.classList.add("imprimir-avaliacoes");
  window.print();
  document.body.classList.remove("imprimir-avaliacoes");
});

// ---------- painel ----------
async function loadPainel() {
  const cards = document.getElementById("resumo-cards");
  if (!setorSelecionadoId) {
    cards.innerHTML = '<div class="empty-state">Nenhum setor selecionado. Vá em "Configurações" para cadastrar um setor.</div>';
    document.querySelector("#tbl-atrasadas tbody").innerHTML = "";
    document.querySelector("#tbl-carga tbody").innerHTML = "";
    document.querySelector("#tbl-categoria tbody").innerHTML = "";
    document.getElementById("setor-avaliacao-resumo").innerHTML = "";
    document.querySelector("#tbl-avaliacoes-setor tbody").innerHTML = "";
    document.getElementById("qr-avaliacao-card").classList.add("hidden");
    return;
  }
  atualizarCardQrSetor();
  loadAvaliacaoSetor();
  cards.innerHTML = '<div class="empty-state">Carregando...</div>';
  try {
    const { data, error } = await comTimeout(
      db
        .from("op_atividades")
        .select("*, op_funcionarios(nome), op_categorias(nome)")
        .eq("setor_id", setorSelecionadoId)
        .order("prazo", { ascending: true })
    );
    if (error) throw new Error(error.message);

    const abertas = data.filter((a) => a.status === "aberto");
    const andamento = data.filter((a) => a.status === "andamento");
    const atrasadas = data.filter(estaAtrasada);
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
    const concluidasRecentes = data.filter(
      (a) => a.status === "concluido" && a.data_conclusao && new Date(a.data_conclusao) >= seteDiasAtras
    );
    const avaliadas = data.filter((a) => a.avaliacao_nota);
    const notaMedia = avaliadas.length ? avaliadas.reduce((soma, a) => soma + a.avaliacao_nota, 0) / avaliadas.length : null;

    cards.innerHTML = `
      <div class="resumo-card">
        <div class="resumo-num">${abertas.length}</div>
        <div class="resumo-label">Abertas</div>
      </div>
      <div class="resumo-card">
        <div class="resumo-num">${andamento.length}</div>
        <div class="resumo-label">Em andamento</div>
      </div>
      <div class="resumo-card atrasado">
        <div class="resumo-num">${atrasadas.length}</div>
        <div class="resumo-label">Atrasadas</div>
      </div>
      <div class="resumo-card ok">
        <div class="resumo-num">${concluidasRecentes.length}</div>
        <div class="resumo-label">Concluídas (7 dias)</div>
      </div>
      <div class="resumo-card">
        <div class="resumo-num">${notaMedia ? notaMedia.toFixed(1) + " ★" : "—"}</div>
        <div class="resumo-label">Nota média (${avaliadas.length} avalia${avaliadas.length === 1 ? "ção" : "ções"})</div>
      </div>
    `;

    const tbodyAtrasadas = document.querySelector("#tbl-atrasadas tbody");
    tbodyAtrasadas.innerHTML = atrasadas.length
      ? atrasadas
          .map(
            (a) => `
        <tr>
          <td>${escapeHtml(a.titulo)}</td>
          <td>${escapeHtml(a.op_funcionarios?.nome || "")}</td>
          <td>${escapeHtml(a.op_categorias?.nome || "—")}</td>
          <td>${renderBadgePrioridade(a.prioridade)}</td>
          <td>${formatDate(a.prazo)}</td>
          <td>${renderBadgeStatus(a.status)}</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="6">Nenhuma atividade atrasada. 🎉</td></tr>';

    renderTabelaIndicadores("#tbl-carga tbody", data, (a) => a.op_funcionarios?.nome || "—", 7, "Nenhuma atividade registrada.");
    renderTabelaIndicadores("#tbl-categoria tbody", data, (a) => a.op_categorias?.nome || "Sem categoria", 7, "Nenhuma atividade registrada.");
  } catch (e) {
    cards.innerHTML = `<div class="empty-state">Erro ao carregar: ${e.message}</div>`;
  }
}

document.getElementById("btn-refresh-painel").addEventListener("click", loadPainel);

// Avaliação geral do setor (link fixo, diferente da avaliação por
// atividade): cada envio é uma linha em op_avaliacoes_setor, então aqui só
// resumimos média + lista de comentários recentes.
async function loadAvaliacaoSetor() {
  const resumo = document.getElementById("setor-avaliacao-resumo");
  const tbody = document.querySelector("#tbl-avaliacoes-setor tbody");
  try {
    const { data, error, count } = await comTimeout(
      db
        .from("op_avaliacoes_setor")
        .select("*", { count: "exact" })
        .eq("setor_id", setorSelecionadoId)
        .order("criado_em", { ascending: false })
        .limit(200)
    );
    if (error) throw new Error(error.message);

    const media = data.length ? data.reduce((soma, a) => soma + a.nota, 0) / data.length : null;
    const total = count ?? data.length;
    resumo.innerHTML = `
      <div class="resumo-card">
        <div class="resumo-num">${media ? media.toFixed(1) + " ★" : "—"}</div>
        <div class="resumo-label">Nota média (${total} avalia${total === 1 ? "ção" : "ções"})</div>
      </div>
    `;

    tbody.innerHTML = data.length
      ? data
          .map(
            (a) => `
        <tr>
          <td>${formatDate(a.criado_em.slice(0, 10))}</td>
          <td>${a.empresa ? escapeHtml(a.empresa) : '<span class="muted">—</span>'}</td>
          <td>${renderEstrelas(a.nota)}</td>
          <td>${a.comentario ? escapeHtml(a.comentario) : '<span class="muted">—</span>'}</td>
          <td>${souAdmin() ? `<button class="link-btn danger" data-id="${a.id}">excluir</button>` : ""}</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="5">Nenhuma avaliação de setor recebida ainda.</td></tr>';

    tbody.querySelectorAll(".link-btn[data-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir esta avaliação de setor? Não tem como desfazer.")) return;
        await db.from("op_avaliacoes_setor").delete().eq("id", btn.dataset.id);
        loadAvaliacaoSetor();
      });
    });
  } catch (e) {
    resumo.innerHTML = `<div class="empty-state">Erro ao carregar: ${e.message}</div>`;
  }
}

// Agrupa atividades por uma chave (funcionário, categoria, ...) e renderiza
// uma tabela com contagem por status + atrasadas + total + nota média.
function renderTabelaIndicadores(seletorTbody, atividades, chaveFn, colSpan, msgVazio) {
  const grupos = {};
  atividades.forEach((a) => {
    const chave = chaveFn(a);
    grupos[chave] = grupos[chave] || { aberto: 0, andamento: 0, concluido: 0, atrasadas: 0, somaNotas: 0, qtdNotas: 0 };
    grupos[chave][a.status] = (grupos[chave][a.status] || 0) + 1;
    if (estaAtrasada(a)) grupos[chave].atrasadas++;
    if (a.avaliacao_nota) {
      grupos[chave].somaNotas += a.avaliacao_nota;
      grupos[chave].qtdNotas++;
    }
  });

  const linhas = Object.entries(grupos).sort(([, a], [, b]) => {
    const totalA = a.aberto + a.andamento + a.concluido;
    const totalB = b.aberto + b.andamento + b.concluido;
    return totalB - totalA;
  });

  const tbody = document.querySelector(seletorTbody);
  tbody.innerHTML = linhas.length
    ? linhas
        .map(([nome, c]) => {
          const total = c.aberto + c.andamento + c.concluido;
          const nota = c.qtdNotas ? (c.somaNotas / c.qtdNotas).toFixed(1) : "—";
          return `
        <tr>
          <td>${escapeHtml(nome)}</td>
          <td>${c.aberto}</td>
          <td>${c.andamento}</td>
          <td>${c.concluido}</td>
          <td class="${c.atrasadas ? "prazo-atrasado" : ""}">${c.atrasadas}</td>
          <td>${total}</td>
          <td>${nota}</td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="${colSpan}">${msgVazio}</td></tr>`;
}

function renderBadgeStatus(status) {
  return `<span class="badge status-${status}">${STATUS_LABEL[status] || status}</span>`;
}

function renderBadgePrioridade(prioridade) {
  return `<span class="badge prio-${prioridade}">${PRIORIDADE_LABEL[prioridade] || prioridade}</span>`;
}

// ---------- nova atividade ----------
document.getElementById("ativ-data-abertura").valueAsDate = new Date();

document.getElementById("form-atividade").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("ativ-feedback");
  feedback.textContent = "";
  feedback.className = "feedback";

  if (!setorSelecionadoId) {
    feedback.textContent = "Selecione um setor no topo da tela antes de registrar uma atividade.";
    feedback.className = "feedback error";
    return;
  }

  const funcionarioId = document.getElementById("ativ-funcionario").value;
  if (!funcionarioId) {
    feedback.textContent = "Cadastre um funcionário em Configurações antes de registrar uma atividade.";
    feedback.className = "feedback error";
    return;
  }

  const payload = {
    setor_id: Number(setorSelecionadoId),
    titulo: document.getElementById("ativ-titulo").value.trim(),
    funcionario_id: Number(funcionarioId),
    categoria_id: document.getElementById("ativ-categoria").value || null,
    prioridade: document.getElementById("ativ-prioridade").value,
    data_abertura: document.getElementById("ativ-data-abertura").value,
    prazo: document.getElementById("ativ-prazo").value || null,
    cliente_nome: document.getElementById("ativ-cliente-nome").value.trim(),
    cliente_whatsapp: document.getElementById("ativ-cliente-whatsapp").value.trim(),
    descricao: document.getElementById("ativ-descricao").value.trim(),
  };

  try {
    const { error } = await db.from("op_atividades").insert(payload);
    if (error) throw new Error(error.message);
    feedback.textContent = "Atividade registrada com sucesso!";
    feedback.className = "feedback success";
    document.getElementById("form-atividade").reset();
    document.getElementById("ativ-data-abertura").valueAsDate = new Date();
    document.getElementById("ativ-prioridade").value = "media";
  } catch (err) {
    feedback.textContent = "Erro: " + err.message;
    feedback.className = "feedback error";
  }
});

// ---------- atividades ----------
async function loadAtividades() {
  const tbody = document.querySelector("#tbl-atividades tbody");
  if (!setorSelecionadoId) {
    tbody.innerHTML = '<tr><td colspan="9">Nenhum setor selecionado.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="9">Carregando...</td></tr>';

  const status = document.getElementById("fil-status").value;
  const funcionarioId = document.getElementById("fil-funcionario").value;
  const categoriaId = document.getElementById("fil-categoria").value;
  const prioridade = document.getElementById("fil-prioridade").value;

  try {
    let query = db
      .from("op_atividades")
      .select("*, op_funcionarios(nome), op_categorias(nome)")
      .eq("setor_id", setorSelecionadoId)
      .order("status")
      .order("prazo", { ascending: true, nullsFirst: false });
    if (status) query = query.eq("status", status);
    if (funcionarioId) query = query.eq("funcionario_id", funcionarioId);
    if (categoriaId) query = query.eq("categoria_id", categoriaId);
    if (prioridade) query = query.eq("prioridade", prioridade);

    const { data: rows, error } = await comTimeout(query);
    if (error) throw new Error(error.message);

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9">Nenhuma atividade encontrada.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map((a) => {
        const prazoClasse = estaAtrasada(a) ? "prazo-atrasado" : "";
        let acoes = "";
        if (a.status === "aberto") acoes += `<button class="link-btn" data-id="${a.id}" data-acao="iniciar">iniciar</button> `;
        if (a.status === "andamento") acoes += `<button class="link-btn" data-id="${a.id}" data-acao="concluir">concluir</button> `;
        if (a.status === "concluido") acoes += `<button class="link-btn" data-id="${a.id}" data-acao="reabrir">reabrir</button> `;
        acoes += `<button class="link-btn" data-id="${a.id}" data-acao="editar-titulo">editar</button> `;
        if (souAdmin()) acoes += `<button class="link-btn danger" data-id="${a.id}" data-acao="excluir">excluir</button>`;

        let avaliacao;
        if (a.avaliacao_respondida_em) {
          avaliacao = `<div>${renderEstrelas(a.avaliacao_nota)}</div>${
            a.avaliacao_resolveu === false ? '<div class="muted">problema não resolvido</div>' : ""
          }${a.avaliacao_comentario ? `<div class="muted comentario-cliente">"${escapeHtml(a.avaliacao_comentario)}"</div>` : ""}`;
        } else if (a.status === "concluido" && a.cliente_whatsapp) {
          avaliacao = `<a class="link-btn" target="_blank" rel="noopener" href="${escapeHtml(
            linkWhatsapp(
              a.cliente_whatsapp,
              `Olá${a.cliente_nome ? " " + a.cliente_nome : ""}! Poderia avaliar o serviço "${a.titulo}" que realizamos? ${linkAvaliacao(a.avaliacao_token)}`
            )
          )}">enviar p/ WhatsApp</a>`;
        } else if (a.status === "concluido") {
          avaliacao = '<span class="muted">sem WhatsApp do cliente</span>';
        } else {
          avaliacao = '<span class="muted">—</span>';
        }

        return `
        <tr>
          <td>
            <strong>${escapeHtml(a.titulo)}</strong>
            ${a.descricao ? `<div class="muted">${escapeHtml(a.descricao)}</div>` : ""}
            ${a.cliente_nome ? `<div class="muted">Cliente: ${escapeHtml(a.cliente_nome)}</div>` : ""}
          </td>
          <td>${escapeHtml(a.op_funcionarios?.nome || "")}</td>
          <td>${escapeHtml(a.op_categorias?.nome || "—")}</td>
          <td>${renderBadgePrioridade(a.prioridade)}</td>
          <td>${formatDate(a.data_abertura)}</td>
          <td class="${prazoClasse}">${formatDate(a.prazo) || "—"}</td>
          <td>${renderBadgeStatus(a.status)}</td>
          <td>${avaliacao}</td>
          <td class="acoes">${acoes}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".link-btn[data-acao]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const acao = btn.dataset.acao;
        if (acao === "excluir") {
          if (!confirm("Excluir esta atividade?")) return;
          await db.from("op_atividades").delete().eq("id", id);
        } else if (acao === "iniciar") {
          await db.from("op_atividades").update({ status: "andamento" }).eq("id", id);
        } else if (acao === "concluir") {
          await db.from("op_atividades").update({ status: "concluido", data_conclusao: new Date().toISOString() }).eq("id", id);
        } else if (acao === "reabrir") {
          await db.from("op_atividades").update({ status: "aberto", data_conclusao: null }).eq("id", id);
        } else if (acao === "editar-titulo") {
          const atividade = rows.find((a) => String(a.id) === String(id));
          if (!atividade) return;

          const novoTitulo = prompt("Novo título:", atividade.titulo);
          if (novoTitulo === null) return;
          const tituloLimpo = novoTitulo.trim();

          const novoPrazoTexto = prompt("Novo prazo (dd/mm/aaaa, deixe vazio pra remover):", formatDate(atividade.prazo));
          if (novoPrazoTexto === null) return;
          const prazoLimpo = novoPrazoTexto.trim();

          const payload = {};
          if (tituloLimpo && tituloLimpo !== atividade.titulo) payload.titulo = tituloLimpo;

          if (prazoLimpo === "") {
            if (atividade.prazo !== null) payload.prazo = null;
          } else {
            const partes = prazoLimpo.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (!partes) return alert("Prazo inválido. Use o formato dd/mm/aaaa.");
            const [, d, m, y] = partes;
            const prazoIso = `${y}-${m}-${d}`;
            if (prazoIso !== atividade.prazo) payload.prazo = prazoIso;
          }

          if (Object.keys(payload).length === 0) return;
          const { error } = await db.from("op_atividades").update(payload).eq("id", id);
          if (error) return alert("Erro ao editar atividade: " + error.message);
        }
        loadAtividades();
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9">Erro: ${e.message}</td></tr>`;
  }
}

document.getElementById("btn-filtrar-atividades").addEventListener("click", loadAtividades);

// ---------- alinhamentos ----------
document.getElementById("alin-data").valueAsDate = new Date();

// ---------- gravação + transcrição por IA do alinhamento ----------
let mediaRecorderAlinhamento = null;
let audioChunksAlinhamento = [];
let audioBlobAlinhamento = null;
let audioPathAlinhamento = null;
let gravacaoInicioTs = null;
let gravacaoTimerInterval = null;
let mimeTypeGravacaoAtual = "";

// Gravação segmentada: reuniões longas (1h30+) estouram o tempo que a
// Vercel dá pra função de transcrição rodar, mesmo com o arquivo dentro do
// limite de tamanho. A gravação ao vivo é cortada sozinha a cada
// DURACAO_SEGMENTO_MS, gerando vários arquivos pequenos nos bastidores (sem
// o usuário perceber nada), cada um transcrito separadamente e depois
// juntados. Só entra em jogo quando a gravação passa desse tempo — gravações
// curtas e o fluxo de "usar áudio do computador" continuam exatamente como
// antes (segmentosFinalizados fica vazio nesses casos).
const DURACAO_SEGMENTO_MS = 25 * 60 * 1000;
let segmentosGravados = [];
let segmentosFinalizados = [];
let gravacaoSegmentadaAtiva = false;
let segmentoRestartInterval = null;

// O Chrome grava em audio/webm, mas o Safari/iOS não suporta webm — grava
// em audio/mp4 (ou nada, se nenhum dos dois funcionar). Fixar "webm" sempre
// quebrava no iPhone; aqui pergunta pro navegador qual formato ele
// realmente consegue gravar antes de começar.
function mimeTypeSuportadoGravacao() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
  const candidatos = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/aac", "audio/ogg;codecs=opus"];
  return candidatos.find((tipo) => MediaRecorder.isTypeSupported(tipo)) || "";
}

// Taxa de bits baixa o suficiente pra voz continuar inteligível, mas que
// mantém reuniões longas dentro do limite de 25MB que o Whisper aceita por
// arquivo (uma reunião de 2h de áudio contínuo já tinha estourado isso).
const BITRATE_GRAVACAO = 24000;
const LIMITE_BYTES_AUDIO = 24 * 1024 * 1024;

function extensaoPara(mimeType) {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("aac")) return "aac";
  return "webm";
}

// Compressão de recuperação: se um áudio (gravação antiga, de antes do
// BITRATE_GRAVACAO mais baixo, ou vindo de um arquivo externo) ainda estiver
// grande demais pra IA aceitar, recomprime no próprio navegador antes de
// desistir. Usa decodeAudioData (nativo do navegador) + lamejs (encoder MP3
// em JavaScript puro, sem WebAssembly) rodando numa Web Worker — diferente
// do ffmpeg.wasm, não depende de SharedArrayBuffer/crossOriginIsolated, que
// o Vercel não tem configurado aqui.
const LAMEJS_CDN_URL = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";

function criarWorkerMp3() {
  const scriptWorker = `
    self.importScripts(${JSON.stringify(LAMEJS_CDN_URL)});
    self.onmessage = (e) => {
      const { pcm, sampleRate, kbps } = e.data;
      try {
        const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
        const tamanhoBloco = 1152;
        const blocos = [];
        let bytesTotais = 0;
        for (let i = 0; i < pcm.length; i += tamanhoBloco) {
          const bloco = encoder.encodeBuffer(pcm.subarray(i, i + tamanhoBloco));
          if (bloco.length > 0) { blocos.push(bloco); bytesTotais += bloco.length; }
        }
        const fim = encoder.flush();
        if (fim.length > 0) { blocos.push(fim); bytesTotais += fim.length; }
        const saida = new Uint8Array(bytesTotais);
        let offset = 0;
        for (const bloco of blocos) { saida.set(bloco, offset); offset += bloco.length; }
        self.postMessage({ ok: true, dados: saida }, [saida.buffer]);
      } catch (err) {
        self.postMessage({ ok: false, erro: String(err && err.message || err) });
      }
    };
  `;
  const blobUrl = URL.createObjectURL(new Blob([scriptWorker], { type: "application/javascript" }));
  const worker = new Worker(blobUrl);
  worker.addEventListener("message", () => URL.revokeObjectURL(blobUrl), { once: true });
  return worker;
}

async function comprimirAudio(blob, status) {
  if (status) status.textContent = "Lendo áudio...";
  const AudioContextClasse = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClasse) throw new Error("Navegador sem suporte a Web Audio API.");
  const audioCtx = new AudioContextClasse();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    audioCtx.close();
  }

  // Mixa pra mono (média dos canais, se houver mais de um).
  const canal0 = audioBuffer.getChannelData(0);
  const pcmFloat = new Float32Array(canal0.length);
  if (audioBuffer.numberOfChannels > 1) {
    const canal1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < canal0.length; i++) pcmFloat[i] = (canal0[i] + canal1[i]) / 2;
  } else {
    pcmFloat.set(canal0);
  }
  const pcmInt16 = new Int16Array(pcmFloat.length);
  for (let i = 0; i < pcmFloat.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat[i]));
    pcmInt16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  if (status) status.textContent = "Comprimindo áudio longo — pode levar alguns minutos, não feche esta aba...";
  const worker = criarWorkerMp3();
  try {
    const resultado = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => (e.data.ok ? resolve(e.data.dados) : reject(new Error(e.data.erro)));
      worker.onerror = (e) => reject(new Error(e.message || "Erro na compressão."));
      worker.postMessage({ pcm: pcmInt16, sampleRate: audioBuffer.sampleRate, kbps: BITRATE_GRAVACAO / 1000 }, [pcmInt16.buffer]);
    });
    return new Blob([resultado], { type: "audio/mpeg" });
  } finally {
    worker.terminate();
  }
}

// Sobe um segmento de gravação (independente do fluxo de audioBlobAlinhamento
// / garantirAudioEnviado, que continua intocado) e devolve a URL pública.
async function enviarSegmento(blob) {
  let blobFinal = blob;
  if (blob.size > LIMITE_BYTES_AUDIO) {
    const status = document.getElementById("gravacao-status");
    const tamanhoOriginalMB = (blob.size / 1024 / 1024).toFixed(1);
    try {
      blobFinal = await comprimirAudio(blob, status);
    } catch (err) {
      throw new Error(`Segmento de ${tamanhoOriginalMB}MB é grande demais e a compressão falhou (${err.message}).`);
    }
    if (blobFinal.size > LIMITE_BYTES_AUDIO) {
      throw new Error(`Segmento continua grande demais mesmo após compressão (${(blobFinal.size / 1024 / 1024).toFixed(1)}MB).`);
    }
  }
  const tipoAudio = blobFinal.type || "audio/webm";
  const nomeArquivo = `${crypto.randomUUID()}.${extensaoPara(tipoAudio)}`;
  const { error: erroUpload } = await db.storage.from("op_audios").upload(nomeArquivo, blobFinal, { contentType: tipoAudio });
  if (erroUpload) throw new Error("Erro ao enviar segmento: " + erroUpload.message);
  return `${SUPABASE_URL}/storage/v1/object/public/op_audios/${nomeArquivo}`;
}

// Transcreve uma gravação longa que foi dividida em vários segmentos: envia
// e transcreve cada um na sequência (só o texto bruto, sem formatar ata por
// parte — isso geraria títulos tipo "Resumo/Pontos discutidos" repetidos 4x),
// junta tudo marcado por parte, e manda pra IA formatar UMA ata única no
// final a partir do texto completo. É o processo manual (VLC + várias
// transcrições + juntar na mão) só que automático e já consolidado.
async function transcreverSegmentos(segmentos, status) {
  let transcricaoCompleta = "";
  for (let i = 0; i < segmentos.length; i++) {
    status.textContent = `Enviando parte ${i + 1} de ${segmentos.length}...`;
    const audioUrl = await enviarSegmento(segmentos[i]);
    status.textContent = `Transcrevendo parte ${i + 1} de ${segmentos.length} (pode levar um tempo)...`;
    const resp = await fetch("/api/transcrever", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioUrl, somenteTranscricao: true }),
    });
    const textoResp = await resp.text();
    let data;
    try {
      data = JSON.parse(textoResp);
    } catch {
      throw new Error(`Parte ${i + 1}: resposta inesperada do servidor (status ${resp.status}).`);
    }
    if (!resp.ok) throw new Error(`Parte ${i + 1}: ` + (data.error || "Erro ao transcrever."));
    transcricaoCompleta += (transcricaoCompleta ? "\n\n" : "") + `=== Parte ${i + 1} ===\n` + (data.transcricao || "");
  }

  status.textContent = "Gerando ata consolidada a partir de todas as partes...";
  const respAta = await fetch("/api/transcrever", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcricaoDireta: transcricaoCompleta }),
  });
  const textoRespAta = await respAta.text();
  let dataAta;
  try {
    dataAta = JSON.parse(textoRespAta);
  } catch {
    throw new Error(`Ata consolidada: resposta inesperada do servidor (status ${respAta.status}).`);
  }
  if (!respAta.ok) throw new Error("Ata consolidada: " + (dataAta.error || "Erro ao formatar."));

  const assuntoTexto = typeof dataAta.assunto === "string" ? dataAta.assunto : "";
  if (assuntoTexto && !document.getElementById("alin-assunto").value.trim()) {
    document.getElementById("alin-assunto").value = assuntoTexto;
  }
  const ataTexto = typeof dataAta.ata === "string" ? dataAta.ata : JSON.stringify(dataAta.ata, null, 2);
  const obsAtual = document.getElementById("alin-observacao").value.trim();
  document.getElementById("alin-observacao").value = obsAtual ? obsAtual + "\n\n" + ataTexto : ataTexto;
  status.textContent = "Transcrição completa (todas as partes) — revise o texto antes de salvar.";
}

function formatarTimer(segundosTotais) {
  const m = String(Math.floor(segundosTotais / 60)).padStart(2, "0");
  const s = String(segundosTotais % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function resetarGravacaoAlinhamento() {
  audioChunksAlinhamento = [];
  audioBlobAlinhamento = null;
  audioPathAlinhamento = null;
  mimeTypeGravacaoAtual = "";
  segmentosGravados = [];
  segmentosFinalizados = [];
  gravacaoSegmentadaAtiva = false;
  clearInterval(segmentoRestartInterval);
  document.getElementById("audio-preview").classList.add("hidden");
  document.getElementById("audio-preview").src = "";
  document.getElementById("btn-transcrever-audio").classList.add("hidden");
  document.getElementById("btn-gravar-audio").classList.remove("hidden");
  document.getElementById("btn-parar-gravacao").classList.add("hidden");
  document.getElementById("gravacao-status").textContent = "";
  document.getElementById("gravacao-timer").textContent = "00:00";
}

// Sobe audioBlobAlinhamento pro bucket op_audios (se ainda não tiver sido
// enviado) e devolve a URL pública. Usada tanto logo após a gravação quanto
// como retry dentro do botão "Transcrever com IA" caso o upload automático
// tenha falhado.
async function garantirAudioEnviado() {
  if (audioPathAlinhamento) {
    return `${SUPABASE_URL}/storage/v1/object/public/op_audios/${audioPathAlinhamento}`;
  }
  if (!audioBlobAlinhamento) throw new Error("Nenhum áudio gravado.");
  if (audioBlobAlinhamento.size > LIMITE_BYTES_AUDIO) {
    const status = document.getElementById("gravacao-status");
    const tamanhoOriginalMB = (audioBlobAlinhamento.size / 1024 / 1024).toFixed(1);
    try {
      audioBlobAlinhamento = await comprimirAudio(audioBlobAlinhamento, status);
      mimeTypeGravacaoAtual = "audio/mpeg";
      const preview = document.getElementById("audio-preview");
      preview.src = URL.createObjectURL(audioBlobAlinhamento);
    } catch (err) {
      throw new Error(
        `Áudio de ${tamanhoOriginalMB}MB é grande demais e a compressão automática falhou (${err.message}). ` +
          `Grave reuniões assim em partes menores, ou comprima o arquivo manualmente antes (ex: VLC → Mídia → ` +
          `Converter/Salvar → perfil "Audio - MP3", 32kb/s, mono) e carregue o arquivo já comprimido.`
      );
    }
    if (audioBlobAlinhamento.size > LIMITE_BYTES_AUDIO) {
      const tamanhoFinalMB = (audioBlobAlinhamento.size / 1024 / 1024).toFixed(1);
      throw new Error(`Áudio comprimido de ${tamanhoOriginalMB}MB para ${tamanhoFinalMB}MB, mas ainda acima do limite da IA (~25MB). Grave reuniões assim em partes menores.`);
    }
    if (status) status.textContent = `Áudio comprimido de ${tamanhoOriginalMB}MB para ${(audioBlobAlinhamento.size / 1024 / 1024).toFixed(1)}MB. Enviando...`;
  }
  const tipoAudio = audioBlobAlinhamento.type || mimeTypeGravacaoAtual || "audio/webm";
  const nomeArquivo = `${crypto.randomUUID()}.${extensaoPara(tipoAudio)}`;
  const { error: erroUpload } = await db.storage.from("op_audios").upload(nomeArquivo, audioBlobAlinhamento, { contentType: tipoAudio });
  if (erroUpload) throw new Error("Erro ao enviar áudio: " + erroUpload.message);
  audioPathAlinhamento = nomeArquivo;
  return `${SUPABASE_URL}/storage/v1/object/public/op_audios/${nomeArquivo}`;
}

document.getElementById("btn-gravar-audio").addEventListener("click", async () => {
  const status = document.getElementById("gravacao-status");
  status.textContent = "";
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    status.textContent = "Seu navegador não suporta gravação de áudio.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    segmentosGravados = [];
    segmentosFinalizados = [];
    gravacaoSegmentadaAtiva = true;

    // Cria (e, internamente, recria a cada corte de segmento) o gravador
    // sobre o mesmo stream de microfone, sem o usuário perceber nada.
    function iniciarSegmento() {
      audioChunksAlinhamento = [];
      mimeTypeGravacaoAtual = mimeTypeSuportadoGravacao();
      mediaRecorderAlinhamento = mimeTypeGravacaoAtual
        ? new MediaRecorder(stream, { mimeType: mimeTypeGravacaoAtual, audioBitsPerSecond: BITRATE_GRAVACAO })
        : new MediaRecorder(stream, { audioBitsPerSecond: BITRATE_GRAVACAO });
      // Em alguns navegadores (ex. iOS Safari) o mimeType efetivo só fica
      // disponível depois de criado o MediaRecorder, mesmo sem passar opções.
      mimeTypeGravacaoAtual = mediaRecorderAlinhamento.mimeType || mimeTypeGravacaoAtual || "audio/webm";
      mediaRecorderAlinhamento.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksAlinhamento.push(e.data);
      };
      mediaRecorderAlinhamento.onstop = async () => {
        const segmento = new Blob(audioChunksAlinhamento, { type: mimeTypeGravacaoAtual });
        segmentosGravados.push(segmento);

        if (gravacaoSegmentadaAtiva) {
          // Parada interna (corte por tempo) — segue gravando sem o usuário notar.
          iniciarSegmento();
          mediaRecorderAlinhamento.start();
          return;
        }

        // Parada final (usuário clicou "Parar").
        stream.getTracks().forEach((t) => t.stop());
        const preview = document.getElementById("audio-preview");
        document.getElementById("btn-transcrever-audio").classList.remove("hidden");

        if (segmentosGravados.length > 1) {
          // Gravação longa, dividida em partes — mantém só o fluxo novo
          // (segmentosFinalizados); não toca em audioBlobAlinhamento/
          // audioPathAlinhamento, que seguem exclusivos do fluxo de
          // arquivo único (usado por "usar áudio do computador").
          segmentosFinalizados = segmentosGravados.slice();
          preview.src = URL.createObjectURL(segmentosGravados[segmentosGravados.length - 1]);
          preview.classList.remove("hidden");
          status.textContent = `Gravação longa dividida em ${segmentosGravados.length} partes automaticamente. Clique em "Transcrever com IA" para processar todas, ou salve o alinhamento direto (sem áudio anexado).`;
          return;
        }

        // Só um segmento (gravação não passou do corte) — comportamento
        // idêntico ao de antes, usando o fluxo de arquivo único normal.
        audioBlobAlinhamento = segmentosGravados[0];
        preview.src = URL.createObjectURL(audioBlobAlinhamento);
        preview.classList.remove("hidden");
        try {
          await garantirAudioEnviado();
          status.textContent = "Áudio salvo. Clique em \"Transcrever com IA\" para gerar a ata automaticamente, ou salve o alinhamento direto.";
        } catch (err) {
          status.textContent = "Gravação pronta, mas houve erro ao salvar o áudio: " + err.message;
        }
      };
    }

    iniciarSegmento();
    mediaRecorderAlinhamento.start();
    gravacaoInicioTs = Date.now();
    document.getElementById("gravacao-timer").textContent = "00:00";
    clearInterval(gravacaoTimerInterval);
    clearInterval(segmentoRestartInterval);
    // Corta a gravação técnica a cada DURACAO_SEGMENTO_MS (o onstop acima
    // já reinicia na hora) — reuniões longas nunca geram um único arquivo
    // grande demais pro tempo que a IA tem pra transcrever.
    segmentoRestartInterval = setInterval(() => {
      if (mediaRecorderAlinhamento && mediaRecorderAlinhamento.state === "recording") {
        mediaRecorderAlinhamento.stop();
      }
    }, DURACAO_SEGMENTO_MS);
    gravacaoTimerInterval = setInterval(() => {
      const segundos = Math.floor((Date.now() - gravacaoInicioTs) / 1000);
      document.getElementById("gravacao-timer").textContent = formatarTimer(segundos);
    }, 1000);
    document.getElementById("btn-gravar-audio").classList.add("hidden");
    document.getElementById("btn-parar-gravacao").classList.remove("hidden");
    document.getElementById("btn-transcrever-audio").classList.add("hidden");
    document.getElementById("audio-preview").classList.add("hidden");
    audioPathAlinhamento = null;
  } catch (err) {
    status.textContent = "Não foi possível acessar o microfone: " + err.message;
  }
});

document.getElementById("btn-parar-gravacao").addEventListener("click", () => {
  gravacaoSegmentadaAtiva = false;
  clearInterval(segmentoRestartInterval);
  if (mediaRecorderAlinhamento && mediaRecorderAlinhamento.state !== "inactive") {
    mediaRecorderAlinhamento.stop();
  }
  clearInterval(gravacaoTimerInterval);
  document.getElementById("btn-parar-gravacao").classList.add("hidden");
  document.getElementById("btn-gravar-audio").classList.remove("hidden");
});

document.getElementById("btn-usar-audio-arquivo").addEventListener("click", () => {
  document.getElementById("input-audio-arquivo").click();
});

document.getElementById("input-audio-arquivo").addEventListener("change", (e) => {
  const arquivo = e.target.files[0];
  e.target.value = "";
  if (!arquivo) return;
  audioBlobAlinhamento = arquivo;
  mimeTypeGravacaoAtual = arquivo.type || "audio/webm";
  audioPathAlinhamento = null;
  segmentosGravados = [];
  segmentosFinalizados = [];
  const preview = document.getElementById("audio-preview");
  preview.src = URL.createObjectURL(arquivo);
  preview.classList.remove("hidden");
  document.getElementById("btn-transcrever-audio").classList.remove("hidden");
  const tamanhoMB = (arquivo.size / 1024 / 1024).toFixed(1);
  document.getElementById("gravacao-status").textContent =
    arquivo.size > LIMITE_BYTES_AUDIO
      ? `Arquivo carregado (${tamanhoMB}MB) — acima do limite da IA, será comprimido automaticamente ao transcrever/salvar.`
      : `Arquivo carregado (${tamanhoMB}MB). Pode transcrever com IA ou salvar direto.`;
});

document.getElementById("btn-transcrever-audio").addEventListener("click", async () => {
  const status = document.getElementById("gravacao-status");
  const btn = document.getElementById("btn-transcrever-audio");

  if (segmentosFinalizados.length > 1) {
    // Gravação longa cortada automaticamente em partes — fluxo separado,
    // não mexe em audioBlobAlinhamento/garantirAudioEnviado.
    btn.disabled = true;
    try {
      await transcreverSegmentos(segmentosFinalizados, status);
    } catch (err) {
      status.textContent = "Erro: " + err.message;
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (!audioBlobAlinhamento) return;
  btn.disabled = true;
  status.textContent = "Enviando áudio...";
  try {
    const audioUrl = await garantirAudioEnviado();

    status.textContent = "Transcrevendo com IA (pode levar um minuto)...";
    const resp = await fetch("/api/transcrever", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioUrl }),
    });
    const textoResp = await resp.text();
    let data;
    try {
      data = JSON.parse(textoResp);
    } catch {
      // O servidor devolveu algo que não é JSON (ex: página de erro/timeout
      // da própria Vercel) — provavelmente a transcrição demorou demais.
      throw new Error(
        resp.status === 504 || resp.status === 0
          ? "O servidor demorou demais pra transcrever (áudio muito longo). Tente um áudio mais curto."
          : `Resposta inesperada do servidor (status ${resp.status}).`
      );
    }
    if (!resp.ok) throw new Error(data.error || "Erro ao transcrever.");

    const assuntoTexto = typeof data.assunto === "string" ? data.assunto : "";
    if (assuntoTexto && !document.getElementById("alin-assunto").value.trim()) {
      document.getElementById("alin-assunto").value = assuntoTexto;
    }
    const ataTexto = typeof data.ata === "string" ? data.ata : JSON.stringify(data.ata, null, 2);
    const obsAtual = document.getElementById("alin-observacao").value.trim();
    document.getElementById("alin-observacao").value = obsAtual ? obsAtual + "\n\n" + ataTexto : ataTexto;
    status.textContent = "Transcrição pronta — revise o texto antes de salvar.";
  } catch (err) {
    status.textContent = "Erro: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("form-alinhamento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("alin-feedback");
  feedback.textContent = "";
  feedback.className = "feedback";

  if (!setorSelecionadoId) {
    feedback.textContent = "Selecione um setor no topo da tela antes de registrar um alinhamento.";
    feedback.className = "feedback error";
    return;
  }

  const assunto = document.getElementById("alin-assunto").value.trim();
  if (!assunto) return;

  const payload = {
    setor_id: Number(setorSelecionadoId),
    funcionario_id: document.getElementById("alin-funcionario").value || null,
    assunto,
    data: document.getElementById("alin-data").value,
    observacao: document.getElementById("alin-observacao").value.trim(),
    audio_path: audioPathAlinhamento,
  };

  try {
    const { error } = await db.from("op_alinhamentos").insert(payload);
    if (error) throw new Error(error.message);
    feedback.textContent = "Alinhamento registrado com sucesso!";
    feedback.className = "feedback success";
    document.getElementById("form-alinhamento").reset();
    resetarGravacaoAlinhamento();
    document.getElementById("alin-data").valueAsDate = new Date();
    loadAlinhamentos();
  } catch (err) {
    feedback.textContent = "Erro: " + err.message;
    feedback.className = "feedback error";
  }
});

async function loadAlinhamentos() {
  const tbody = document.querySelector("#tbl-alinhamentos tbody");
  if (!setorSelecionadoId) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum setor selecionado.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="5">Carregando...</td></tr>';

  try {
    const { data: rows, error } = await comTimeout(
      db
        .from("op_alinhamentos")
        .select("*, op_funcionarios(nome)")
        .eq("setor_id", setorSelecionadoId)
        .order("data", { ascending: false })
        .order("id", { ascending: false })
    );
    if (error) throw new Error(error.message);

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">Nenhum alinhamento registrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map((a) => {
        let acoes = `<button class="link-btn" data-id="${a.id}" data-acao="editar">editar</button> `;
        acoes += `<button class="link-btn" data-id="${a.id}" data-acao="pdf">PDF</button> `;
        if (souAdmin()) acoes += `<button class="link-btn danger" data-id="${a.id}" data-acao="excluir">excluir</button>`;
        const audioTag = a.audio_path
          ? `<audio controls preload="none" src="${SUPABASE_URL}/storage/v1/object/public/op_audios/${escapeHtml(a.audio_path)}"></audio>`
          : "";
        return `
        <tr>
          <td>${formatDate(a.data)}</td>
          <td>${escapeHtml(a.op_funcionarios?.nome || "Setor em geral")}</td>
          <td>${escapeHtml(a.assunto)}</td>
          <td class="observacao">${a.observacao ? escapeHtml(a.observacao).replace(/\n/g, "<br>") : '<span class="muted">—</span>'}${audioTag}</td>
          <td class="acoes">${acoes}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".link-btn[data-acao]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const acao = btn.dataset.acao;
        if (acao === "pdf") {
          const alinhamento = rows.find((a) => String(a.id) === String(id));
          if (!alinhamento) return;
          const nomeColaborador = alinhamento.op_funcionarios?.nome || "Setor em geral";
          document.getElementById("imprimir-alinhamento-conteudo").innerHTML = `
            <h2>${escapeHtml(alinhamento.assunto)}</h2>
            <p class="muted">${escapeHtml(nomeColaborador)} · ${formatDate(alinhamento.data)}</p>
            <div class="ata-texto">${alinhamento.observacao ? escapeHtml(alinhamento.observacao) : "Sem observação registrada."}</div>
          `;
          document.body.classList.add("imprimir-alinhamento");
          window.print();
          document.body.classList.remove("imprimir-alinhamento");
          return;
        }
        if (acao === "excluir") {
          if (!confirm("Excluir este alinhamento?")) return;
          await db.from("op_alinhamentos").delete().eq("id", id);
        } else if (acao === "editar") {
          const alinhamento = rows.find((a) => String(a.id) === String(id));
          if (!alinhamento) return;

          const novoAssunto = prompt("Assunto:", alinhamento.assunto);
          if (novoAssunto === null) return;
          const assuntoLimpo = novoAssunto.trim();
          if (!assuntoLimpo) return alert("O assunto não pode ficar vazio.");

          const novaObs = prompt("Observação:", alinhamento.observacao);
          if (novaObs === null) return;

          const payload = {};
          if (assuntoLimpo !== alinhamento.assunto) payload.assunto = assuntoLimpo;
          if (novaObs.trim() !== alinhamento.observacao) payload.observacao = novaObs.trim();

          if (Object.keys(payload).length === 0) return;
          const { error } = await db.from("op_alinhamentos").update(payload).eq("id", id);
          if (error) return alert("Erro ao editar alinhamento: " + error.message);
        }
        loadAlinhamentos();
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5">Erro: ${e.message}</td></tr>`;
  }
}

// ---------- cadastros: funcionarios ----------
document.getElementById("form-funcionario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("func-nome").value.trim();
  const cargo = document.getElementById("func-cargo").value.trim();
  if (!nome) return;
  const setorId = Number(document.getElementById("func-setor").value);
  if (!setorId) return alert("Selecione um setor.");
  const { error } = await db.from("op_funcionarios").insert({ nome, cargo, setor_id: setorId });
  if (error) return alert("Erro ao adicionar funcionário: " + error.message);
  document.getElementById("func-nome").value = "";
  document.getElementById("func-cargo").value = "";
  await refreshCadastros();
});

function renderListaFuncionarios() {
  const ul = document.getElementById("lista-funcionarios");
  const ativosSetores = setoresCache.filter((s) => s.ativo);
  ul.innerHTML = funcionariosCache
    .map(
      (f) => `
    <li class="${f.ativo ? "" : "inativo"}">
      <span>${escapeHtml(f.nome)}${f.cargo ? ` <span class="muted">· ${escapeHtml(f.cargo)}</span>` : ""}</span>
      <span>
        ${
          ativosSetores.length > 1
            ? `<select class="link-btn-select" data-id="${f.id}" data-acao="mudar-setor">${ativosSetores
                .map((s) => `<option value="${s.id}" ${String(s.id) === String(f.setor_id) ? "selected" : ""}>${escapeHtml(s.nome)}</option>`)
                .join("")}</select>`
            : ""
        }
        <button class="link-btn" data-id="${f.id}" data-ativo="${f.ativo ? 1 : 0}">${f.ativo ? "desativar" : "reativar"}</button>
      </span>
    </li>`
    )
    .join("");
  ul.querySelectorAll('[data-acao="mudar-setor"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      await db.from("op_funcionarios").update({ setor_id: Number(sel.value) }).eq("id", sel.dataset.id);
      await refreshCadastros();
    });
  });
  ul.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novoAtivo = btn.dataset.ativo !== "1";
      await db.from("op_funcionarios").update({ ativo: novoAtivo }).eq("id", btn.dataset.id);
      await refreshCadastros();
    });
  });
}

// ---------- cadastros: categorias ----------
document.getElementById("form-categoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("cat-nome").value.trim();
  if (!nome) return;
  const { error } = await db.from("op_categorias").insert({ nome });
  if (error) return alert("Erro ao adicionar categoria: " + error.message);
  document.getElementById("cat-nome").value = "";
  await refreshCadastros();
});

function renderListaCategorias() {
  const ul = document.getElementById("lista-categorias");
  ul.innerHTML = categoriasCache
    .map(
      (c) => `
    <li class="${c.ativo ? "" : "inativo"}">
      <span>${escapeHtml(c.nome)}</span>
      <button class="link-btn" data-id="${c.id}" data-ativo="${c.ativo ? 1 : 0}">${c.ativo ? "desativar" : "reativar"}</button>
    </li>`
    )
    .join("");
  ul.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novoAtivo = btn.dataset.ativo !== "1";
      await db.from("op_categorias").update({ ativo: novoAtivo }).eq("id", btn.dataset.id);
      await refreshCadastros();
    });
  });
}

// ---------- cadastros: usuários (admin) ----------
let perfisCache = [];

async function loadPerfis() {
  if (!souAdmin()) {
    perfisCache = [];
    return;
  }
  const { data, error } = await comTimeout(db.from("op_perfis").select("*").order("role").order("nome"));
  if (error) throw new Error(error.message);
  const { data: vinculos, error: errVinculos } = await comTimeout(db.from("op_perfis_setores").select("*"));
  if (errVinculos) throw new Error(errVinculos.message);
  perfisCache = data.map((p) => ({
    ...p,
    setorIds: vinculos.filter((v) => v.user_id === p.user_id).map((v) => v.setor_id),
  }));
}

function renderListaPerfis() {
  const ul = document.getElementById("lista-usuarios");
  const ativosSetores = setoresCache.filter((s) => s.ativo);
  ul.innerHTML = perfisCache
    .map((p) => {
      if (p.role === "admin") {
        return `
    <li>
      <span>${escapeHtml(p.nome)} <span class="muted">· admin</span></span>
      <button class="link-btn danger" data-acao="remover" data-id="${p.user_id}">remover acesso</button>
    </li>`;
      }
      const opts = ativosSetores
        .map((s) => `<option value="${s.id}" ${p.setorIds.includes(s.id) ? "selected" : ""}>${escapeHtml(s.nome)}</option>`)
        .join("");
      return `
    <li class="perfil-lider">
      <div class="perfil-lider-nome">${escapeHtml(p.nome)} <span class="muted">· líder</span></div>
      <select class="perfil-setor-select" data-id="${p.user_id}" multiple size="4">${opts}</select>
      <div class="perfil-lider-acoes">
        <button class="link-btn" data-acao="salvar-setores" data-id="${p.user_id}">salvar setores</button>
        <button class="link-btn danger" data-acao="remover" data-id="${p.user_id}">remover acesso</button>
      </div>
    </li>`;
    })
    .join("");

  ul.querySelectorAll('[data-acao="remover"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover o acesso desse usuário ao painel? A conta de login continua existindo no Supabase, só perde a permissão.")) return;
      await db.from("op_perfis_setores").delete().eq("user_id", btn.dataset.id);
      await db.from("op_perfis").delete().eq("user_id", btn.dataset.id);
      await loadPerfis();
      renderListaPerfis();
    });
  });

  ul.querySelectorAll('[data-acao="salvar-setores"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.id;
      const sel = ul.querySelector(`.perfil-setor-select[data-id="${uid}"]`);
      const setorIds = Array.from(sel.selectedOptions).map((o) => Number(o.value));
      if (setorIds.length === 0) return alert("Selecione pelo menos um setor.");
      await db.from("op_perfis_setores").delete().eq("user_id", uid);
      const { error } = await db.from("op_perfis_setores").insert(setorIds.map((setor_id) => ({ user_id: uid, setor_id })));
      if (error) return alert("Erro ao salvar setores: " + error.message);
      await loadPerfis();
      renderListaPerfis();
    });
  });
}

document.getElementById("usu-role").addEventListener("change", (e) => {
  document.getElementById("usu-setor").closest("label").classList.toggle("hidden", e.target.value === "admin");
});

document.getElementById("form-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uid = document.getElementById("usu-uid").value.trim();
  const nome = document.getElementById("usu-nome").value.trim();
  const role = document.getElementById("usu-role").value;
  const setorIds = Array.from(document.getElementById("usu-setor").selectedOptions).map((o) => Number(o.value));
  if (!uid || !nome) return;
  if (role === "lider" && setorIds.length === 0) return alert("Selecione ao menos um setor para o líder.");

  // Se o UID já tem perfil (líder existente), não recria — só adiciona os
  // setores novos marcados, mantendo os que já tinha. Assim dá pra dar mais
  // setores a um líder repetindo o UID dele aqui com os setores extras.
  const jaExiste = perfisCache.some((p) => p.user_id === uid);
  if (!jaExiste) {
    const { error } = await db.from("op_perfis").insert({ user_id: uid, nome, role });
    if (error) return alert("Erro ao adicionar usuário: " + error.message);
  }
  if (role === "lider" && setorIds.length) {
    const { error: errVinculos } = await db
      .from("op_perfis_setores")
      .upsert(setorIds.map((setor_id) => ({ user_id: uid, setor_id })), { onConflict: "user_id,setor_id" });
    if (errVinculos) return alert((jaExiste ? "Erro ao adicionar setores: " : "Usuário criado, mas erro ao vincular setores: ") + errVinculos.message);
  }
  document.getElementById("usu-uid").value = "";
  document.getElementById("usu-nome").value = "";
  document.getElementById("usu-role").value = "lider";
  await loadPerfis();
  renderListaPerfis();
});

async function refreshCadastros() {
  await Promise.all([loadFuncionarios(), loadCategorias()]);
  if (souAdmin()) await loadPerfis();
  atualizarSelectsCadastro();
  renderListaFuncionarios();
  renderListaCategorias();
  if (souAdmin()) renderListaPerfis();
}

// ---------- dados do app (chamado só depois do login) ----------
async function iniciarDadosApp() {
  try {
    await loadSetores();
    renderListaSetores();
    await refreshCadastros();
  } catch (e) {
    console.warn("Erro ao carregar cadastros:", e.message);
  }
  await loadPainel();
}
