const SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZnlxdmVmem5rcGN2amFlcnRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQ4NjgsImV4cCI6MjEwMTc5MDg2OH0.2Ef6LpZ61WM8myHBYeQGo3TuGqk5C3x36ER_sWRNPS4";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const LS_OPERADOR = "op_horimetro_operador";
const container = document.getElementById("horimetro-conteudo");
let token = "";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderErro(msg) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

function formatarHoras(n) {
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// "2026-10-01" -> "outubro de 2026" (sem passar por Date com fuso)
function nomeMes(iso) {
  const [ano, mes] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function isoMes(ano, mes0) {
  const d = new Date(ano, mes0, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Aceita "5432", "5432,5", "5432.5" e "5.432,5". Um ponto seguido de
// exatamente 3 dígitos ("5.432") é tratado como separador de milhar.
function lerNumero(texto) {
  let t = String(texto).trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

function renderLeituras(leituras) {
  if (!leituras.length) return '<p class="muted">Nenhuma leitura enviada ainda.</p>';
  return `<ul class="maq-hist-lista">${leituras
    .map((l) => `<li>${escapeHtml(nomeMes(l.mes))} · ${l.tipo === "inicio" ? "início" : "final"}: <strong>${formatarHoras(l.valor)} h</strong></li>`)
    .join("")}</ul>`;
}

function renderFormulario(maquina) {
  document.title = `Horímetro · ${maquina.codigo}`;
  const hoje = new Date();
  // Padrão: até o dia 15 é a leitura do início do mês; depois, do final.
  // Quem lança o final nos primeiros dias do mês seguinte fica com o mês anterior.
  const tipoPadrao = hoje.getDate() <= 15 ? "inicio" : "fim";
  const mesPadrao = tipoPadrao === "fim" && hoje.getDate() <= 7 ? isoMes(hoje.getFullYear(), hoje.getMonth() - 1) : isoMes(hoje.getFullYear(), hoje.getMonth());
  const meses = [0, 1, 2].map((i) => isoMes(hoje.getFullYear(), hoje.getMonth() - i));

  container.innerHTML = `
    <h2>${escapeHtml(maquina.codigo)}</h2>
    <p class="muted">${escapeHtml(maquina.modelo)}</p>
    <form id="form-horimetro" class="form-card" style="padding:0; border:none;">
      <label>
        Seu nome
        <input type="text" id="hor-operador" placeholder="Nome do operador" required>
      </label>
      <label>
        Leitura de
        <select id="hor-tipo">
          <option value="inicio" ${tipoPadrao === "inicio" ? "selected" : ""}>Início do mês</option>
          <option value="fim" ${tipoPadrao === "fim" ? "selected" : ""}>Final do mês</option>
        </select>
      </label>
      <label>
        Mês
        <select id="hor-mes">
          ${meses.map((m) => `<option value="${m}" ${m === mesPadrao ? "selected" : ""}>${escapeHtml(nomeMes(m))}</option>`).join("")}
        </select>
      </label>
      <label>
        Horímetro (horas)
        <input type="text" id="hor-valor" inputmode="decimal" autocomplete="off" placeholder="Ex.: 5432,5" required>
      </label>
      <button type="submit" class="btn primary">Enviar leitura</button>
      <p id="hor-feedback" class="feedback"></p>
    </form>
    <h3>Últimas leituras enviadas</h3>
    <div id="hor-leituras">${renderLeituras(maquina.leituras || [])}</div>
  `;

  try {
    document.getElementById("hor-operador").value = localStorage.getItem(LS_OPERADOR) || "";
  } catch {}

  document.getElementById("form-horimetro").addEventListener("submit", async (e) => {
    e.preventDefault();
    const feedback = document.getElementById("hor-feedback");
    feedback.className = "feedback";
    const operador = document.getElementById("hor-operador").value.trim();
    const tipo = document.getElementById("hor-tipo").value;
    const mes = document.getElementById("hor-mes").value;
    const valor = lerNumero(document.getElementById("hor-valor").value);
    if (!operador) {
      feedback.textContent = "Informe o seu nome.";
      feedback.className = "feedback error";
      return;
    }
    if (Number.isNaN(valor)) {
      feedback.textContent = "Digite só o número do horímetro (ex.: 5432,5).";
      feedback.className = "feedback error";
      return;
    }
    const rotulo = `${tipo === "inicio" ? "início" : "final"} de ${nomeMes(mes)}`;
    if (!confirm(`Confirma o horímetro de ${rotulo}: ${formatarHoras(valor)} horas?`)) return;

    feedback.textContent = "Enviando...";
    const botao = e.target.querySelector("button[type=submit]");
    botao.disabled = true;
    try {
      const { error } = await db.rpc("op_horimetro_registrar", {
        p_token: token,
        p_mes: mes,
        p_tipo: tipo,
        p_valor: valor,
        p_operador: operador,
      });
      if (error) throw new Error(error.message);
      try {
        localStorage.setItem(LS_OPERADOR, operador);
      } catch {}
      feedback.textContent = `Leitura enviada: ${rotulo} = ${formatarHoras(valor)} h. Obrigado!`;
      feedback.className = "feedback success";
      document.getElementById("hor-valor").value = "";
      const { data } = await db.rpc("op_horimetro_info", { p_token: token });
      if (data) document.getElementById("hor-leituras").innerHTML = renderLeituras(data.leituras || []);
    } catch (err) {
      feedback.textContent = "Erro ao enviar: " + err.message;
      feedback.className = "feedback error";
    } finally {
      botao.disabled = false;
    }
  });
}

(async function init() {
  // Página pública: se esse navegador tiver sessão do painel interno,
  // encerra antes (as regras de acesso do operador valem para anônimo).
  const { data: sessaoAtual } = await db.auth.getSession();
  if (sessaoAtual.session) await db.auth.signOut();

  token = new URLSearchParams(location.search).get("m") || "";
  if (!token) {
    renderErro("Link inválido: nenhum código de máquina informado.");
    return;
  }
  try {
    const { data, error } = await db.rpc("op_horimetro_info", { p_token: token });
    if (error) throw new Error(error.message);
    if (!data) {
      renderErro("Não encontramos essa máquina. O link pode estar incorreto ou a máquina foi desativada.");
      return;
    }
    renderFormulario(data);
  } catch (e) {
    renderErro("Erro ao carregar: " + e.message);
  }
})();
