// Function serverless do Vercel (detectada automaticamente por estar em
// /api). Recebe a URL pública de um áudio já enviado ao Supabase Storage,
// manda pro Whisper (OpenAI) transcrever e depois pro GPT formatar como
// ata curta. A chave da OpenAI fica só aqui no servidor (variável de
// ambiente OPENAI_API_KEY no projeto Vercel) — nunca é exposta no navegador.

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

  const { audioUrl } = req.body || {};
  if (!audioUrl) {
    res.status(400).json({ error: "audioUrl é obrigatório." });
    return;
  }

  try {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) throw new Error("Não foi possível baixar o áudio enviado.");
    const audioBuffer = await audioResp.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: audioResp.headers.get("content-type") || "audio/webm" });

    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "pt");

    const transcricaoResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!transcricaoResp.ok) throw new Error("Erro ao transcrever o áudio: " + (await transcricaoResp.text()));
    const { text: transcricao } = await transcricaoResp.json();

    const ataResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              'Você transforma a transcrição de uma conversa entre gestor e liderado em uma ata curta, em português do Brasil. Responda em JSON válido no formato {"assunto": "...", "ata": "..."}. "assunto" é um título bem curto (até 8 palavras) resumindo o tema principal. "ata" é o corpo organizado em tópicos, no formato: "Resumo:" (1-2 frases), "Pontos discutidos:" (lista com "- "), "Combinados/ações:" (lista com "- ", ou "Nenhum combinado registrado" se não houve nenhum). Seja fiel ao conteúdo da transcrição, não invente informação que não está nela.',
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
      assunto = parsed.assunto || "";
      ata = parsed.ata || ata;
    } catch {
      ata = ataData.choices?.[0]?.message?.content || ata;
    }

    res.status(200).json({ transcricao, assunto, ata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
