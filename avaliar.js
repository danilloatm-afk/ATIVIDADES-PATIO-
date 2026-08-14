const SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZnlxdmVmem5rcGN2amFlcnRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQ4NjgsImV4cCI6MjEwMTc5MDg2OH0.2Ef6LpZ61WM8myHBYeQGo3TuGqk5C3x36ER_sWRNPS4";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const container = document.getElementById("avaliar-conteudo");
let notaSelecionada = 0;
let resolveuSelecionado = null;

function renderErro(msg) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

function renderObrigado(titulo, nota) {
  document.title = `Avaliação enviada · ${titulo}`;
  container.innerHTML = `
    <h2>Obrigado pela avaliação!</h2>
    <p>Sua resposta sobre "<strong>${escapeHtml(titulo)}</strong>" foi registrada.</p>
    <p>Nota enviada: ${"★".repeat(nota)}${"☆".repeat(5 - nota)}</p>
  `;
}

// Monta os 5 botões UMA vez só e usa um único listener delegado no
// container. Recriar os botões a cada clique (innerHTML de novo + rebind)
// é frágil em touch: no celular o toque pode terminar num elemento que
// acabou de ser substituído, fazendo o clique "sumir" ou marcar a estrela
// errada. Agora só o texto (★/☆) de cada botão já existente é atualizado.
function renderEstrelasInterativas() {
  const wrap = document.getElementById("estrelas-wrap");
  wrap.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="estrela-btn" data-n="${n}">☆</button>`).join("");
  atualizarEstrelasVisual();
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".estrela-btn");
    if (!btn) return;
    notaSelecionada = Number(btn.dataset.n);
    atualizarEstrelasVisual();
  });
}

function atualizarEstrelasVisual() {
  document.querySelectorAll(".estrela-btn").forEach((btn) => {
    btn.textContent = Number(btn.dataset.n) <= notaSelecionada ? "★" : "☆";
  });
}

// ---------- avaliação de uma atividade específica (link ?t=) ----------
function renderFormularioAtividade(atividade) {
  document.title = `Avaliar · ${atividade.titulo}`;
  container.innerHTML = `
    <h2>${escapeHtml(atividade.titulo)}</h2>
    <p class="muted">
      ${atividade.op_categorias?.nome ? escapeHtml(atividade.op_categorias.nome) + " · " : ""}
      ${atividade.op_funcionarios?.nome ? "Responsável: " + escapeHtml(atividade.op_funcionarios.nome) + " · " : ""}
      ${formatDate(atividade.data_abertura)}
    </p>
    <form id="form-avaliacao" class="form-card" style="padding:0; border:none;">
      <label>
        Como você avalia esse serviço?
        <div id="estrelas-wrap" class="estrelas-wrap"></div>
      </label>
      <label>
        O problema foi resolvido?
        <div class="resolveu-wrap">
          <button type="button" class="btn secondary" data-resolveu="sim">Sim</button>
          <button type="button" class="btn secondary" data-resolveu="nao">Não</button>
        </div>
      </label>
      <label>
        Comentário (opcional)
        <textarea id="av-comentario" rows="3" placeholder="Conte como foi o atendimento"></textarea>
      </label>
      <button type="submit" class="btn primary">Enviar avaliação</button>
      <p id="av-feedback" class="feedback"></p>
    </form>
  `;

  renderEstrelasInterativas();

  document.querySelectorAll("[data-resolveu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resolveuSelecionado = btn.dataset.resolveu === "sim";
      document.querySelectorAll("[data-resolveu]").forEach((b) => b.classList.remove("selecionado"));
      btn.classList.add("selecionado");
    });
  });

  document.getElementById("form-avaliacao").addEventListener("submit", async (e) => {
    e.preventDefault();
    const feedback = document.getElementById("av-feedback");
    feedback.className = "feedback";
    if (!notaSelecionada) {
      feedback.textContent = "Escolha uma nota de 1 a 5 estrelas.";
      feedback.className = "feedback error";
      return;
    }
    feedback.textContent = "Enviando...";
    try {
      const { error } = await db
        .from("op_atividades")
        .update({
          avaliacao_nota: notaSelecionada,
          avaliacao_resolveu: resolveuSelecionado,
          avaliacao_comentario: document.getElementById("av-comentario").value.trim(),
          avaliacao_respondida_em: new Date().toISOString(),
        })
        .eq("avaliacao_token", atividade.avaliacao_token);
      if (error) throw new Error(error.message);
      renderObrigado(atividade.titulo, notaSelecionada);
    } catch (err) {
      feedback.textContent = "Erro ao enviar: " + err.message;
      feedback.className = "feedback error";
    }
  });
}

async function iniciarAvaliacaoAtividade(token) {
  const { data, error } = await db
    .from("op_atividades")
    .select("titulo, data_abertura, avaliacao_token, avaliacao_nota, avaliacao_resolveu, avaliacao_respondida_em, op_categorias(nome), op_funcionarios(nome)")
    .eq("avaliacao_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    renderErro("Não encontramos essa atividade. O link pode estar incorreto ou expirado.");
    return;
  }
  if (data.avaliacao_respondida_em) {
    renderObrigado(data.titulo, data.avaliacao_nota);
    return;
  }
  renderFormularioAtividade(data);
}

// ---------- avaliação geral do setor (link fixo, ?s=) ----------
// Diferente da avaliação por atividade: este link não expira e pode ser
// usado por vários clientes em momentos diferentes — cada envio cria uma
// linha nova, não existe estado de "já respondido" pro link em si.
function renderFormularioSetor(setor) {
  document.title = `Avaliar setor · ${setor.nome}`;
  container.innerHTML = `
    <h2>${escapeHtml(setor.nome)}</h2>
    <p class="muted">Avalie o atendimento deste setor</p>
    <form id="form-avaliacao" class="form-card" style="padding:0; border:none;">
      <label>
        Como você avalia o setor de ${escapeHtml(setor.nome)}?
        <div id="estrelas-wrap" class="estrelas-wrap"></div>
      </label>
      <label>
        Comentário (opcional)
        <textarea id="av-comentario" rows="3" placeholder="Conte como foi sua experiência"></textarea>
      </label>
      <button type="submit" class="btn primary">Enviar avaliação</button>
      <p id="av-feedback" class="feedback"></p>
    </form>
  `;

  renderEstrelasInterativas();

  document.getElementById("form-avaliacao").addEventListener("submit", async (e) => {
    e.preventDefault();
    const feedback = document.getElementById("av-feedback");
    feedback.className = "feedback";
    if (!notaSelecionada) {
      feedback.textContent = "Escolha uma nota de 1 a 5 estrelas.";
      feedback.className = "feedback error";
      return;
    }
    feedback.textContent = "Enviando...";
    try {
      const { error } = await db.from("op_avaliacoes_setor").insert({
        setor_id: setor.id,
        nota: notaSelecionada,
        comentario: document.getElementById("av-comentario").value.trim(),
      });
      if (error) throw new Error(error.message);
      renderObrigado(setor.nome, notaSelecionada);
    } catch (err) {
      feedback.textContent = "Erro ao enviar: " + err.message;
      feedback.className = "feedback error";
    }
  });
}

async function iniciarAvaliacaoSetor(token) {
  const { data, error } = await db.from("op_setores").select("id, nome").eq("avaliacao_token", token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    renderErro("Não encontramos esse setor. O link pode estar incorreto.");
    return;
  }
  renderFormularioSetor(data);
}

(async function init() {
  const params = new URLSearchParams(location.search);
  const tokenAtividade = params.get("t");
  const tokenSetor = params.get("s");
  if (!tokenAtividade && !tokenSetor) {
    renderErro("Link inválido: nenhum código de avaliação informado.");
    return;
  }
  try {
    if (tokenSetor) {
      await iniciarAvaliacaoSetor(tokenSetor);
    } else {
      await iniciarAvaliacaoAtividade(tokenAtividade);
    }
  } catch (e) {
    renderErro("Erro ao carregar: " + e.message);
  }
})();
