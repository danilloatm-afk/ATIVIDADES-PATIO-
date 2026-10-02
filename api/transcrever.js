// Function serverless do Vercel (detectada automaticamente por estar em
// /api). Recebe a URL pública de um áudio já enviado ao Supabase Storage,
// manda pro Whisper (OpenAI) transcrever e depois pro GPT formatar como
// ata curta. A chave da OpenAI fica só aqui no servidor (variável de
// ambiente OPENAI_API_KEY no projeto Vercel) — nunca é exposta no navegador.

// Converte qualquer coisa (string, objeto, lista) num texto legível, caso
// a IA devolva a "ata" estruturada em vez de uma string simples.
function textoDeQualquerCoisa(valor) {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.map((v) => `- ${textoDeQualquerCoisa(v)}`).join("\n");
  if (valor && typeof valor === "object") {
    return Object.entries(valor)
      .map(([chave, sub]) => `${chave}:\n${textoDeQualquerCoisa(sub)}`)
      .join("\n\n");
  }
  return valor == null ? "" : String(valor);
}

// Manda a transcrição (de um áudio só, ou já concatenada de várias partes)
// pro GPT formatar como ata curta. Extraído num helper porque é usado tanto
// no fluxo normal (1 áudio) quanto no fluxo de consolidação final (várias
// transcrições de uma reunião longa dividida em pedaços).
async function formatarAta(apiKey, transcricao) {
  const ataResp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'Você transforma a transcrição de uma conversa entre gestor e liderado em uma ata curta, em português do Brasil. Responda em JSON válido no formato {"assunto": "...", "ata": "..."} — IMPORTANTE: tanto "assunto" quanto "ata" devem ser STRINGS de texto simples (nunca objetos ou listas aninhadas). "assunto" é um título bem curto (até 8 palavras) resumindo o tema PRINCIPAL da conversa (o assunto que ocupou mais tempo/foi o foco), mesmo que outros assuntos tenham surgido no meio. "ata" é uma única string de texto organizada em tópicos, usando quebras de linha (\\n) dentro da própria string, no formato: "Resumo:" (1-2 frases sobre o assunto principal), linha em branco, "Pontos discutidos:" (linhas "- ", só sobre o assunto principal da reunião), linha em branco, "Outros assuntos:" (linhas "- ", para temas paralelos/pontuais que surgiram no meio da conversa mas não são o foco principal — ex: um comentário rápido sobre outro projeto, uma pergunta de outro tema; omita essa seção inteira, incluindo o título, se não houve nenhum assunto paralelo), linha em branco, "Combinados/ações:" (linhas "- ", combinados de qualquer assunto, principal ou paralelo, ou "Nenhum combinado registrado" se não houve nenhum). A transcrição pode vir com marcações de interlocutor no início de cada fala, tipo "[A]" ou "[B]" (letras identificando pessoas diferentes que falaram) — use isso como contexto pra entender quem disse o quê quando for relevante pra um combinado/ação (ex: "Pessoa B ficou de enviar o relatório"), mas NUNCA invente um nome próprio real a partir dessas letras; refira-se como "Pessoa A", "Pessoa B" etc., a menos que o nome real tenha sido dito na própria fala. A transcrição pode vir em vários trechos marcados com "=== Parte N ===" (de uma reunião longa dividida em pedaços) — nesse caso trate tudo como UMA conversa só e gere UMA ata única, sem repetir títulos por parte. REGRA MAIS IMPORTANTE: use APENAS informações que foram realmente ditas na transcrição. Não infira, não complete, não deduza e não invente números, decisões, nomes ou conclusões que não estejam explicitamente na transcrição — se algo não ficou claro ou não foi dito, simplesmente não mencione, em vez de supor.',
        },
        { role: "user", content: transcricao },
      ],
    }),
  });
  if (!ataResp.ok) throw new Error("Erro ao formatar a ata: " + (await ataResp.text()));
  const ataData = await ataResp.json();
  let assunto = "";
  let ata = transcricao;
  try {
    const parsed = JSON.parse(ataData.choices?.[0]?.message?.content || "{}");
    assunto = typeof parsed.assunto === "string" ? parsed.assunto : textoDeQualquerCoisa(parsed.assunto) || "";
    if (typeof parsed.ata === "string") {
      ata = parsed.ata;
    } else if (parsed.ata && typeof parsed.ata === "object") {
      // Salvaguarda: se a IA devolver "ata" como objeto/lista em vez de
      // string (já aconteceu), monta um texto legível a partir dele em
      // vez de deixar "[object Object]" cair na tela do usuário.
      ata = textoDeQualquerCoisa(parsed.ata);
    }
  } catch {
    ata = ataData.choices?.[0]?.message?.content || ata;
  }
  return { assunto, ata };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY não configurada no Vercel (Settings → Environment Variables)." });
    return;
  }

  const { audioUrl, transcricaoDireta, somenteTranscricao } = req.body || {};

  // Modo consolidação: já temos o texto transcrito (de uma ou mais partes de
  // uma reunião longa) e só precisamos formatar a ata final — pula o Whisper.
  if (transcricaoDireta) {
    try {
      const { assunto, ata } = await formatarAta(apiKey, transcricaoDireta);
      res.status(200).json({ transcricao: transcricaoDireta, assunto, ata });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (!audioUrl) {
    res.status(400).json({ error: "audioUrl ou transcricaoDireta é obrigatório." });
    return;
  }

  try {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) throw new Error("Não foi possível baixar o áudio enviado.");
    const audioBuffer = await audioResp.arrayBuffer();
    const tipoAudio = audioResp.headers.get("content-type") || "audio/webm";
    const audioBlob = new Blob([audioBuffer], { type: tipoAudio });

    // O Whisper usa a extensão do nome do arquivo pra saber o formato —
    // mandar sempre "audio.webm" quebrava áudios gravados no iPhone (que
    // chegam como audio/mp4). Deriva a extensão real do content-type.
    const extensaoPorTipo = { "audio/mp4": "mp4", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm", "audio/mpeg": "mp3", "audio/mp3": "mp3" };
    const tipoBase = tipoAudio.split(";")[0].trim();
    const extensao = extensaoPorTipo[tipoBase] || (audioUrl.match(/\.(\w+)$/)?.[1] ?? "webm");

    // gpt-4o-transcribe-diarize: mesmo preço por minuto do whisper-1, mas já
    // identifica quem fala (rotulado como "A", "B", "C"...), o que antes só
    // dava pra conseguir gravando cada pessoa separadamente. Se esse modelo
    // (mais novo) recusar o arquivo, tenta o whisper-1 clássico antes de
    // desistir — sem identificação de voz, mas com a transcrição garantida.
    function pedirTranscricao(modelo) {
      const formData = new FormData();
      formData.append("file", audioBlob, `audio.${extensao}`);
      formData.append("model", modelo);
      formData.append("language", "pt");
      if (modelo === "gpt-4o-transcribe-diarize") {
        formData.append("response_format", "diarized_json");
        formData.append("chunking_strategy", "auto");
      }
      return fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
    }

    let transcricaoResp = await pedirTranscricao("gpt-4o-transcribe-diarize");
    if (!transcricaoResp.ok) {
      const erroDiarize = await transcricaoResp.text();
      transcricaoResp = await pedirTranscricao("whisper-1");
      if (!transcricaoResp.ok) {
        throw new Error(
          `Erro ao transcrever o áudio (${Math.round(audioBuffer.byteLength / 1024)}KB, ${tipoAudio}): ` +
            (await transcricaoResp.text()) +
            ` | modelo com identificação de voz: ${erroDiarize}`
        );
      }
    }
    const transcricaoData = await transcricaoResp.json();
    // Monta o texto com marcação de interlocutor por segmento ("[A] fala...")
    // quando a resposta vem diarizada; se por algum motivo vier sem
    // segmentos, cai pro texto corrido simples (compatibilidade).
    const transcricao = Array.isArray(transcricaoData.segments) && transcricaoData.segments.length > 0
      ? transcricaoData.segments.map((seg) => `[${seg.speaker}] ${seg.text}`).join("\n")
      : transcricaoData.text || "";

    // Modo "só transcrição": usado pelas partes individuais de uma gravação
    // longa segmentada — pula a formatação de ata aqui (seria descartada
    // mesmo, já que a ata final é gerada uma vez só, depois de juntar o
    // texto de todas as partes) e economiza uma chamada de GPT por parte.
    if (somenteTranscricao) {
      res.status(200).json({ transcricao });
      return;
    }

    const { assunto, ata } = await formatarAta(apiKey, transcricao);

    res.status(200).json({ transcricao, assunto, ata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
