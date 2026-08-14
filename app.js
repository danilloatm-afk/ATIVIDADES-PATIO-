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
  const { data, error } = await comTimeout(db.from("op_setores").select("*").order("ativo", { ascending: false }).order("nome"));
  if (error) throw new Error(error.message);
  setoresCache = data;

  const ativos = setoresCache.filter((s) => s.ativo);
  if (!ativos.some((s) => String(s.id) === String(setorSelecionadoId))) {
    setorSelecionadoId = ativos[0] ? String(ativos[0].id) : "";
    localStorage.setItem(LS_SETOR_SELECIONADO, setorSelecionadoId);
  }

  const sel = document.getElementById("setor-select");
  sel.innerHTML = ativos.length
    ? ativos.map((s) => `<option value="${s.id}">${escapeHtml(s.nome)}</option>`).join("")
    : '<option value="">Nenhum setor cadastrado</option>';
  sel.value = setorSelecionadoId;
}

document.getElementById("setor-select").addEventListener("change", (e) => {
  setorSelecionadoId = e.target.value;
  localStorage.setItem(LS_SETOR_SELECIONADO, setorSelecionadoId);
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
  });
});

// ---------- caches de cadastro ----------
let funcionariosCache = [];
let categoriasCache = [];

async function loadFuncionarios() {
  const { data, error } = await comTimeout(db.from("op_funcionarios").select("*").order("ativo", { ascending: false }).order("nome"));
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
}

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
    return;
  }
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
    const { data, error } = await comTimeout(
      db.from("op_avaliacoes_setor").select("*").eq("setor_id", setorSelecionadoId).order("criado_em", { ascending: false })
    );
    if (error) throw new Error(error.message);

    const media = data.length ? data.reduce((soma, a) => soma + a.nota, 0) / data.length : null;
    resumo.innerHTML = `
      <div class="resumo-card">
        <div class="resumo-num">${media ? media.toFixed(1) + " ★" : "—"}</div>
        <div class="resumo-label">Nota média (${data.length} avalia${data.length === 1 ? "ção" : "ções"})</div>
      </div>
    `;

    tbody.innerHTML = data.length
      ? data
          .slice(0, 20)
          .map(
            (a) => `
        <tr>
          <td>${formatDate(a.criado_em.slice(0, 10))}</td>
          <td>${renderEstrelas(a.nota)}</td>
          <td>${a.comentario ? escapeHtml(a.comentario) : '<span class="muted">—</span>'}</td>
        </tr>`
          )
          .join("")
      : '<tr><td colspan="3">Nenhuma avaliação de setor recebida ainda.</td></tr>';
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
        acoes += `<button class="link-btn danger" data-id="${a.id}" data-acao="excluir">excluir</button>`;

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
        }
        loadAtividades();
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9">Erro: ${e.message}</td></tr>`;
  }
}

document.getElementById("btn-filtrar-atividades").addEventListener("click", loadAtividades);

// ---------- cadastros: funcionarios ----------
document.getElementById("form-funcionario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("func-nome").value.trim();
  const cargo = document.getElementById("func-cargo").value.trim();
  if (!nome) return;
  const { error } = await db.from("op_funcionarios").insert({ nome, cargo });
  if (error) return alert("Erro ao adicionar funcionário: " + error.message);
  document.getElementById("func-nome").value = "";
  document.getElementById("func-cargo").value = "";
  await refreshCadastros();
});

function renderListaFuncionarios() {
  const ul = document.getElementById("lista-funcionarios");
  ul.innerHTML = funcionariosCache
    .map(
      (f) => `
    <li class="${f.ativo ? "" : "inativo"}">
      <span>${escapeHtml(f.nome)}${f.cargo ? ` <span class="muted">· ${escapeHtml(f.cargo)}</span>` : ""}</span>
      <button class="link-btn" data-id="${f.id}" data-ativo="${f.ativo ? 1 : 0}">${f.ativo ? "desativar" : "reativar"}</button>
    </li>`
    )
    .join("");
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

async function refreshCadastros() {
  await Promise.all([loadFuncionarios(), loadCategorias()]);
  atualizarSelectsCadastro();
  renderListaFuncionarios();
  renderListaCategorias();
}

// ---------- init ----------
(async function init() {
  try {
    await loadSetores();
    renderListaSetores();
    await refreshCadastros();
  } catch (e) {
    console.warn("Erro ao carregar cadastros:", e.message);
  }
  await loadPainel();
})();
